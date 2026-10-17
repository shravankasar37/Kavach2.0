"""
Kavach scam-text classifier: fine-tunes paraphrase-multilingual-MiniLM-L12-v2 (50+ languages incl. Hindi,
Marathi) on data/prepared/train.csv, picks the epoch with the best validation F1, then reports on the REAL
held-out test set (test_real.csv) for both the fp32 model and the int8 ONNX export that is deployed.

Kaggle script kernel, GPU on, internet on, dataset shravankasar37/kavach-scam-sms attached.
Outputs (/kaggle/working): model/ (tokenizer + config), kavach.int8.onnx, metrics.json
"""
import glob
import json
import os
import random
import subprocess
import sys

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "onnx", "onnxruntime", "onnxscript"], check=True)

import numpy as np
import onnxruntime as ort
import pandas as pd
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from sklearn.metrics import average_precision_score, f1_score, precision_score, recall_score, roc_auc_score
from torch.utils.data import DataLoader
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

SEED, BASE, MAX_LEN, EPOCHS, BATCH, LR = 26104, "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", 128, 5, 32, 4e-5
OUT = "/kaggle/working"
random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")

DATA = os.path.dirname(glob.glob("/kaggle/input/**/train.csv", recursive=True)[0])
train, val, test = (pd.read_csv(f"{DATA}/{n}.csv") for n in ("train", "val", "test_real"))
spot = pd.read_json(glob.glob("/kaggle/input/**/india_in_the_wild.jsonl", recursive=True)[0], lines=True)
print({n: len(d) for n, d in (("train", train), ("val", val), ("test_real", test), ("spot", spot))})

tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForSequenceClassification.from_pretrained(BASE, num_labels=2).to(dev)


def batches(df, shuffle):
    idx = list(range(len(df)))
    return DataLoader(idx, batch_size=BATCH, shuffle=shuffle,
                      collate_fn=lambda ix: (tok(list(df.text.iloc[ix]), truncation=True, max_length=MAX_LEN, padding=True, return_tensors="pt"),
                                             torch.tensor(df.label.iloc[ix].values)))


@torch.no_grad()
def probs(df):
    model.eval()
    out = []
    for enc, _ in batches(df, False):
        logits = model(**{k: v.to(dev) for k, v in enc.items()}).logits
        out.append(torch.softmax(logits.float(), -1)[:, 1].cpu().numpy())
    return np.concatenate(out)


def report(y, p, thr):
    pred = (p >= thr).astype(int)
    return {"n": int(len(y)), "scam": int(y.sum()), "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y, pred)), 4), "f1": round(float(f1_score(y, pred)), 4),
            "roc_auc": round(float(roc_auc_score(y, p)), 4), "pr_auc": round(float(average_precision_score(y, p)), 4),
            "false_positive_rate": round(float(((pred == 1) & (y == 0)).sum() / max(1, (y == 0).sum())), 4)}


w = torch.tensor([len(train) / (2 * (train.label == 0).sum()), len(train) / (2 * (train.label == 1).sum())], dtype=torch.float, device=dev)
loss_fn = torch.nn.CrossEntropyLoss(weight=w)
opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
loader = batches(train, True)
sched = get_linear_schedule_with_warmup(opt, int(0.1 * EPOCHS * len(loader)), EPOCHS * len(loader))

best, history = -1.0, []
for ep in range(1, EPOCHS + 1):
    model.train()
    for enc, y in loader:
        loss = loss_fn(model(**{k: v.to(dev) for k, v in enc.items()}).logits, y.to(dev))
        opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step()
    pv = probs(val)
    r = report(val.label.values, pv, 0.5)
    history.append({"epoch": ep, "val": r})
    print(ep, r, flush=True)
    if r["f1"] > best:
        best = r["f1"]
        model.save_pretrained(f"{OUT}/model"); tok.save_pretrained(f"{OUT}/model")

model = AutoModelForSequenceClassification.from_pretrained(f"{OUT}/model").to(dev)
# decision threshold: best F1 on validation (training-side data), then frozen for the real test
pv = probs(val)
thr = max(np.arange(0.1, 0.95, 0.05), key=lambda t: f1_score(val.label.values, (pv >= t).astype(int)))
pt = probs(test)
metrics = {"base": BASE, "epochs": EPOCHS, "history": history, "threshold": round(float(thr), 2),
           "test_real_fp32": report(test.label.values, pt, thr)}
print("test fp32", metrics["test_real_fp32"])

# ---- ONNX export + int8 (MatMul/Gemm per-channel, as in VaaniShield) ----
model.cpu().eval()
enc = tok(["test message"], return_tensors="pt")
torch.onnx.export(model, (enc["input_ids"], enc["attention_mask"]), f"{OUT}/fp32.onnx", input_names=["input_ids", "attention_mask"],
                  output_names=["logits"], dynamic_axes={"input_ids": {0: "b", 1: "s"}, "attention_mask": {0: "b", 1: "s"}, "logits": {0: "b"}},
                  opset_version=17, dynamo=False)
quantize_dynamic(f"{OUT}/fp32.onnx", f"{OUT}/kavach.int8.onnx", weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"],
                 per_channel=True, reduce_range=True)
os.remove(f"{OUT}/fp32.onnx")
sess = ort.InferenceSession(f"{OUT}/kavach.int8.onnx", providers=["CPUExecutionProvider"])


def onnx_probs(texts):
    out = []
    for i in range(0, len(texts), 64):
        e = tok(list(texts[i:i + 64]), truncation=True, max_length=MAX_LEN, padding=True, return_tensors="np")
        lg = sess.run(None, {"input_ids": e["input_ids"].astype(np.int64), "attention_mask": e["attention_mask"].astype(np.int64)})[0]
        ex = np.exp(lg - lg.max(1, keepdims=True))
        out.append((ex / ex.sum(1, keepdims=True))[:, 1])
    return np.concatenate(out)


metrics["test_real_int8"] = report(test.label.values, onnx_probs(test.text.values), thr)
metrics["int8_size_mb"] = round(os.path.getsize(f"{OUT}/kavach.int8.onnx") / 1e6, 1)
sp = onnx_probs(spot.text.values)
metrics["india_in_the_wild"] = [{"type": t, "p_scam": round(float(p), 4), "flagged": bool(p >= thr), "text": x[:90]} for t, p, x in zip(spot.type, sp, spot.text)]
json.dump(metrics, open(f"{OUT}/metrics.json", "w"), indent=2, ensure_ascii=False)
print(json.dumps(metrics, indent=2, ensure_ascii=False))
