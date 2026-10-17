# Kavach classifier API on Render's free tier: FastAPI + onnxruntime + tokenizers (no torch).
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=10000
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# model files live on the Hugging Face Hub (the ONNX file is over GitHub's 100 MB limit)
ARG HF_REPO=shravan37/kavach-scam-classifier
RUN mkdir -p app/model && python -c "import sys, urllib.request as u; [u.urlretrieve(f'https://huggingface.co/{sys.argv[1]}/resolve/main/{f}', f'app/model/{f}') for f in ('kavach.int8.onnx', 'sentencepiece.bpe.model', 'metrics.json')]" "$HF_REPO"
COPY app/*.py ./app/
EXPOSE 10000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
