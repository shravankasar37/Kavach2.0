"""Re-exports the trained classifier with its 250k-token embedding table quantized too (Gather -> int8), so the
serving model fits a 512 MB host, and re-checks accuracy on the real test set with the exact serving stack
(onnxruntime + tokenizers).

    <python with torch+transformers> training/shrink_onnx.py training/results <out_dir>
"""
import json
import os
import sys

import numpy as np
import onnxruntime as ort
import pandas as pd
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from sklearn.metrics import f1_score, precision_score, recall_score, roc_auc_score
from tokenizers import Tokenizer
from transformers import AutoModelForSequenceClassification, AutoTokenizer

res, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
meta = json.load(open(f"{res}/metrics.json", encoding="utf-8"))
thr = meta["threshold"]

model = AutoModelForSequenceClassification.from_pretrained(f"{res}/model").eval()
hf_tok = AutoTokenizer.from_pretrained(f"{res}/model")
enc = hf_tok(["test message"], return_tensors="pt")
torch.onnx.export(model, (enc["input_ids"], enc["attention_mask"]), f"{out}/fp32.onnx", input_names=["input_ids", "attention_mask"],
                  output_names=["logits"], dynamic_axes={"input_ids": {0: "b", 1: "s"}, "attention_mask": {0: "b", 1: "s"}, "logits": {0: "b"}},
                  opset_version=17, dynamo=False)
quantize_dynamic(f"{out}/fp32.onnx", f"{out}/kavach.int8.onnx", weight_type=QuantType.QInt8,
                 op_types_to_quantize=["MatMul", "Gemm", "Gather"], per_channel=True, reduce_range=True)
os.remove(f"{out}/fp32.onnx")
size = os.path.getsize(f"{out}/kavach.int8.onnx") / 1e6

tok = Tokenizer.from_file(f"{res}/model/tokenizer.json")
tok.enable_truncation(128)
tok.enable_padding()
sess = ort.InferenceSession(f"{out}/kavach.int8.onnx", providers=["CPUExecutionProvider"])


def probs(texts):
    ps = []
    for i in range(0, len(texts), 64):
        b = tok.encode_batch(list(texts[i:i + 64]))
        ids = np.array([e.ids for e in b], dtype=np.int64)
        mask = np.array([e.attention_mask for e in b], dtype=np.int64)
        lg = sess.run(None, {"input_ids": ids, "attention_mask": mask})[0]
        ex = np.exp(lg - lg.max(1, keepdims=True))
        ps.append((ex / ex.sum(1, keepdims=True))[:, 1])
    return np.concatenate(ps)


test = pd.read_csv(sys.argv[3] if len(sys.argv) > 3 else "data/prepared/test_real.csv")
p = probs(test.text.values)
y = test.label.values
pred = (p >= thr).astype(int)
r = {"size_mb": round(size, 1), "precision": round(precision_score(y, pred), 4), "recall": round(recall_score(y, pred), 4),
     "f1": round(f1_score(y, pred), 4), "roc_auc": round(roc_auc_score(y, p), 4),
     "false_positive_rate": round(float(((pred == 1) & (y == 0)).sum() / (y == 0).sum()), 4)}
print(json.dumps(r))
meta["test_real_int8_gather"] = r
json.dump(meta, open(f"{out}/metrics.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
