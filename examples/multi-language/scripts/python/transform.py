import json
import os
import yaml
from datetime import datetime, timezone

# Read input from previous step
input_path = "/input/python-analyze/enriched.json"
with open(input_path) as f:
    enriched = json.load(f)
print(f"Read enriched data from {input_path}")

# Create final summary
total_languages = sum(len(langs) for langs in enriched["languagesByCategory"].values())
best_category = max(enriched["categories"].items(), key=lambda x: x[1]["avgScore"])

summary = {
    "generatedBy": "python-transform",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "pipeline": "multi-lang-example",
    "stepsCompleted": ["node-analyze", "node-transform", "python-analyze", "python-transform"],
    "totalLanguages": total_languages,
    "bestCategory": {
        "name": best_category[0],
        "avgScore": best_category[1]["avgScore"],
        "rating": best_category[1]["rating"],
    },
    "allCategories": {
        cat: {
            "rating": info["rating"],
            "avgScore": info["avgScore"],
            "languages": enriched["languagesByCategory"].get(cat, []),
        }
        for cat, info in enriched["categories"].items()
    },
}

# Write both YAML and JSON outputs
yaml_path = os.path.join("/output", "summary.yaml")
json_path = os.path.join("/output", "summary.json")

with open(yaml_path, "w") as f:
    yaml.dump(summary, f, default_flow_style=False, sort_keys=False)
print(f"Summary YAML written to {yaml_path}")

with open(json_path, "w") as f:
    json.dump(summary, f, indent=2)
print(f"Summary JSON written to {json_path}")

print(f"Pipeline complete! Best category: {best_category[0]} ({best_category[1]['avgScore']} avg)")
