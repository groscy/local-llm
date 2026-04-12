# Vendored Hugging Face → GGUF converter

This folder contains a **pinned snapshot** of:

- `convert_hf_to_gguf.py`
- `gguf-py/` (the `gguf` Python package used by that script)

from [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp). Revision: see `VENDOR_REVISION.txt`.

**License:** MIT (see `gguf-py/LICENSE`). Do not remove license files.

## Updating the snapshot

Maintainers can refresh from upstream:

```bash
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git .tmp-llama
cp .tmp-llama/convert_hf_to_gguf.py .
rm -rf gguf-py && cp -R .tmp-llama/gguf-py .
git -C .tmp-llama rev-parse HEAD > VENDOR_REVISION.txt
rm -rf .tmp-llama
```

Then commit and verify `pip install -r requirements-convert.txt` still runs conversion on a sample model.
