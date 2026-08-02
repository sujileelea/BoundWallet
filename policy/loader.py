"""봉투 정의 로더. rulesets/*.yaml → dict, /shared 스키마로 검증."""

import json
from pathlib import Path

import jsonschema
import yaml

_REPO_ROOT = Path(__file__).resolve().parent.parent
_ENVELOPE_SCHEMA = json.loads((_REPO_ROOT / "shared" / "envelope.schema.json").read_text())
RULESETS_DIR = Path(__file__).resolve().parent / "rulesets"


def load_envelope(envelope_id: str) -> dict:
    path = RULESETS_DIR / f"{envelope_id}.yaml"
    envelope = yaml.safe_load(path.read_text())
    jsonschema.validate(envelope, _ENVELOPE_SCHEMA)
    return envelope
