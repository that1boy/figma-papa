# Serving GLM-5.3-Flash for Forma

This note is for the team that runs the internal model endpoint. Forma needs
only an OpenAI-compatible `POST /v1/chat/completions` route. Everything below
reflects public third-party information about GLM-5.3-Flash as of October
2026. Check it against the model card and your vLLM or SGLang version before
relying on it.

## What Forma sends

| Feature | How Forma uses it | Setting |
| --- | --- | --- |
| Images | Reference images on planning and the first screen build; rendered screenshots during review | `GLM_VISION=auto` (default) retries once without images if the endpoint answers 400, and remembers that until restart. `on` / `off` force it. `GLM_MAX_IMAGES` caps images per request (default 8). |
| Reasoning | Sends `reasoning_effort` per stage. GLM-5.3-Flash always thinks; this sets how much | `GLM_REASONING_EFFORT` (default `high`), with per-stage overrides `GLM_EFFORT_PLAN`, `GLM_EFFORT_BUILD`, `GLM_EFFORT_REVIEW` (default `low`), `GLM_EFFORT_EDIT` |
| Streaming | `stream: true` with `stream_options.include_usage`, so the UI shows progress and long generations do not hit proxy idle timeouts | `GLM_STREAM=true` (default). Non-streaming JSON replies are also accepted. |
| JSON output | The planning and review stages ask for JSON. Building writes raw HTML/CSS in tagged blocks, so it never depends on JSON mode | `GLM_JSON_MODE=true` adds `response_format: {type: "json_object"}`; `GLM_STRUCTURED_OUTPUT=true` sends a JSON schema |
| Concurrency | One generation fans out to several parallel calls (one per screen) | `GLM_PARALLEL` (default 3) per job, times `MAX_CONCURRENT_JOBS` (default 2) jobs |
| Tools | Not used. Application code runs every step | — |

System prompts are fixed strings with no project data, so prefix caching on
the server makes repeated calls much cheaper. The build system prompt is
about 5,000 tokens.

## Example vLLM launch

Published recipes pair GLM-5.3-Flash with the GLM-4.7 tool parser and the
GLM-4.5 reasoning parser:

```sh
vllm serve zai-org/GLM-5.3-Flash \
  --served-model-name glm-5.3-flash \
  --reasoning-parser glm45 \
  --tool-call-parser glm47 --enable-auto-tool-choice \
  --limit-mm-per-prompt '{"image": 8}' \
  --enable-prefix-caching
```

Points to verify on your deployment:

- **Reasoning parser.** If reasoning text shows up inside `content` (Forma
  shows a `<think>` block in its debug output, or JSON parsing fails),
  the parser is not separating it. One third-party model card reports that
  `deepseek_r1` is needed on some vLLM versions. Forma strips `<think>…</think>`
  from content defensively, but a correct parser saves output tokens.
- **Disabling thinking.** Reports say GLM-5.3-Flash does not support turning
  thinking off, and that doing so degrades output. Use `reasoning_effort: low`
  instead. Do not set `enable_thinking: false` in `GLM_EXTRA_BODY`.
- **Context and output length.** Listings give a context of about 1M tokens
  and up to 131,072 output tokens. Forma requests `GLM_MAX_TOKENS` (default
  32,768) per call. A 12-screen revision of a large design can need more.
- **Image limits.** Some hosted endpoints allow at most 8 images per request.
  Keep `GLM_MAX_IMAGES` at or below your server's `--limit-mm-per-prompt`.

## Checking the endpoint from Forma

1. Set `MODEL_MODE=glm`, `GLM_BASE_URL` (the `/v1` prefix), `GLM_MODEL` (the
   served model name) and `GLM_API_KEY` if needed.
2. Start Forma and press **Check connection**. This is a text-only smoke test.
3. Create a UI project with one reference screenshot and generate. The Checks
   tab lists every model call with its stage, duration and token counts. If
   `imagesDropped` appears, the endpoint rejected image input.
