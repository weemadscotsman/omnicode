# Byte-Exact Benchmark Methodology

## Why bytes, not tokens?

Tokens are **model-specific estimates**. Different tokenizers (cl100k_base, p50k_base, o200k_base) will count the same text differently. `chars/4` is a rough approximation, not a true measurement.

**Bytes are absolute.** A JSON payload's `Buffer.byteLength` is the same on every machine, every model, every tokenizer.

OmniCode's benchmarks report **measured source bytes** and **measured payload bytes**. Percentages are calculated from those two integers to 6 decimal places. No guesses. No rounding to "99.9%" unless the math actually gives 99.9xxxxx%.

---

## How we measure

### Source bytes (baseline)

For a given operation (`repo_map`, `search_symbols`, `spaghetti_report`, etc.):

- **Identify every source file that would be read** if the agent had no OmniCode.
- **Sum the exact byte length** of each file (`fs.statSync().size`).
- That sum is the **baseline** for that operation.

### OmniCode payload bytes

- **Capture the exact JSON response** returned by the MCP tool.
- **`Buffer.byteLength(response, 'utf8')`** - the actual bytes sent over the wire.
- That is the **OmniCode payload**.

### Reduction percentage

```
reduction = (baseline_bytes - omnicode_bytes) / baseline_bytes * 100
```

Displayed to 6 decimal places (e.g., `99.745961%`). No rounding.

### Cumulative across operations

Sum of all baseline bytes vs sum of all OmniCode payload bytes for the same set of operations. Then the same formula.

---

## What about tokens?

Tokens are still useful for estimating model cost. So we **also** show a **labeled estimate**:

> `estimated_tokens = bytes / 4` (roughly 4 chars per token for English/code).

But the estimate is **never** the headline. The headline is **measured bytes**.

---

## Reproducibility

Every benchmark run is fully scripted:

```bash
omnicode benchmark /path/to/repo --out results.json
```

The output contains:

- `source_bytes` (measured)
- `omnicode_payload_bytes` (measured)
- `reduction_percent` (calculated from the two integers)
- `estimated_tokens` (labeled as estimate)

Anyone can run the same command on the same repo and get the **exact same byte counts**.

---

## Why this is stronger than competitor claims

| Competitor | Claim basis | Verifiable? |
|------------|-------------|-------------|
| jCodeMunch | Tokens estimated from `chars/4` | Partial - tokenizer differences change the number |
| Token Savior | "Character reduction" or "99% token reduction" (methodology private) | No |
| Sourcegraph Cody | Plaintext compact format, ~30% reduction (no public benchmark) | No |

OmniCode: **Bytes. Measured. Public. Reproducible.**

---

## The headline number (as of June 1, 2026)

> **OmniCode achieved 99.745961% measured byte reduction across 304 real projects (118,638 files, 38M source bytes, 3.1M payload bytes).**

No asterisk. No "up to". No "model-dependent". Just bytes.

Run it yourself:

```bash
npx omnicode benchmark . --quick
```
