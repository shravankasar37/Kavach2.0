"""Kavach scam classifier: the fine-tuned multilingual MiniLM, served as int8 ONNX (no torch).

Tokenisation uses the original SentencePiece model with the XLM-R id convention instead of the HF tokenizers
JSON: identical ids on the whole test set, but ~41 MB of RAM instead of ~260 MB for the 250k-piece vocabulary,
which is what lets the service fit a 512 MB host.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np

MODEL_DIR = Path(os.environ.get("KAVACH_MODEL_DIR", Path(__file__).resolve().parent / "model"))
MAX_LEN = 128
BOS, EOS, UNK = 0, 2, 3  # XLM-R special ids; SentencePiece ids are shifted by +1 and its unk (0) maps to 3


@lru_cache(maxsize=1)
def _load():
    import onnxruntime as ort
    import sentencepiece as spm

    sp = spm.SentencePieceProcessor(model_file=str(MODEL_DIR / "sentencepiece.bpe.model"))
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.enable_cpu_mem_arena = False  # small host: free memory after each run
    sess = ort.InferenceSession(str(MODEL_DIR / "kavach.int8.onnx"), opts, providers=["CPUExecutionProvider"])
    meta = json.loads((MODEL_DIR / "metrics.json").read_text(encoding="utf-8"))
    return sp, sess, float(meta.get("threshold", 0.5))


def available() -> bool:
    return (MODEL_DIR / "kavach.int8.onnx").exists() and (MODEL_DIR / "sentencepiece.bpe.model").exists()


def threshold() -> float:
    return _load()[2]


def encode(sp, text: str) -> list[int]:
    ids = [i + 1 if i != 0 else UNK for i in sp.encode(text)]
    return [BOS] + ids[: MAX_LEN - 2] + [EOS]


def scam_probability(text: str) -> float:
    sp, sess, _ = _load()
    ids = np.array([encode(sp, text)], dtype=np.int64)
    logits = sess.run(None, {"input_ids": ids, "attention_mask": np.ones_like(ids)})[0][0]
    e = np.exp(logits - logits.max())
    return float(e[1] / e.sum())
