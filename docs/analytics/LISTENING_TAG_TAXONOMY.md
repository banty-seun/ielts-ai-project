# Listening Tag Taxonomy

## Version

- Current version: `1.0.0`
- Source of truth: `shared/listening/questionContracts.ts` (`LISTENING_TAG_TAXONOMY_VERSION`)

## Tags

### Base tags

- `numbers`
- `dates`
- `maps`
- `directions`
- `synonyms`
- `vocabulary`
- `detail`
- `inference`
- `attitude`
- `general`

### Engine-specific tags

- `spelling_capture`
- `instruction_limit_violation`
- `map_spatial_reference`
- `matching_pair_confusion`

## Consumer guidance

- Unknown tags are treated as invalid in quality checks and fall back to `general` in scoring pipelines.
- Consumers should store `taxonomyVersion` alongside analytics records.
- Backward-compatible updates:
  - adding new tags with no semantic changes to existing tags
- Breaking updates:
  - removing/renaming tags
  - changing tag semantics

## Change policy

- Backward-compatible additions: bump `minor` (for example, `1.1.0`).
- Breaking changes: bump `major` (for example, `2.0.0`).
