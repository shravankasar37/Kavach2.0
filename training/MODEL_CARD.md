---
license: mit
language: [en, hi, mr]
tags: [text-classification, scam-detection, smishing, phishing, sms, hinglish, onnx, india]
base_model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
pipeline_tag: text-classification
---

# Kavach scam-message classifier (int8 ONNX)

Detects scam / smishing SMS and WhatsApp messages in English, Hindi, Marathi and Hinglish. Powers
[Kavach](https://github.com/shravankasar37) by [Shravan Kasar](https://github.com/shravankasar37).

## Files

- `kavach.int8.onnx` (118.5 MB): fine-tuned `paraphrase-multilingual-MiniLM-L12-v2` with int8 dynamic quantization of
  MatMul/Gemm **and the 250k-token embedding (Gather)**: 470 MB fp32 → 118.5 MB with identical test accuracy.
- `sentencepiece.bpe.model`: tokenizer. Use XLM-R ids: `<s>`=0, `</s>`=2, `<unk>`=3, SentencePiece id + 1.
  This uses ~41 MB of RAM instead of ~260 MB for the HF `tokenizer.json`, so the whole service runs in ~260 MB.
- `metrics.json`: training history and test results. Decision threshold: 0.35 (best F1 on validation).

Inputs `input_ids`, `attention_mask` (int64, max 128 tokens); output `logits` [batch, 2], index 1 = scam.

## Data

- Training (5,806 msgs): real messages from the SMS Smishing Collection (UCI-derived), the audited synthetic
  Indian set `Ridham115/indian-scam-sms-synthetic-audited` (CC BY 4.0, includes hard negatives), and the
  `India Cyber Scam Hinglish` set reduced from 10,000 rows to its 743 unique templates.
- Excluded: "Indian Scam SMS 30k", whose scam URLs contain the word "scam" (label leakage).
- **Test: 1,031 real messages** (128 smishing, 903 genuine), a stratified 20% split carved out before training.

## Results on the real test set

| | Precision | Recall | F1 | ROC-AUC | False-positive rate |
|---|---|---|---|---|---|
| fp32 | 0.992 | 0.969 | 0.980 | 0.9995 | 0.11% |
| **int8 (this file)** | **0.992** | **0.969** | **0.980** | **0.9994** | **0.11%** |

Indian scams quoted verbatim in news (electricity disconnection ×3, job offer, India Post): 5/5 flagged at
97-99.7%. Five messages is a spot check, not a benchmark.

## Limitations

The real test set is English (UK) SMS; there is no public real Indian test set, and the synthetic Indian data
comes from LLMs, so accuracy on real Hindi and Marathi scams is not measured yet. New scam scripts will drift
from the training data. Use as a warning signal alongside the rule-based signals in Kavach, not as proof.
