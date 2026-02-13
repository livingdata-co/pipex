import json
import os
import yaml
from datetime import datetime, timezone

# Read input from previous step
input_path = "/input/node-transform/report.json"
with open(input_path) as f:
    report = json.load(f)
print(f"Read report from {input_path}")

# Enrich with Python analysis
enriched = {
    "generatedBy": "python-analyze",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "sourceStep": "node-transform",
    "categories": {},
}

for cat, stats in report["summary"].items():
    enriched["categories"][cat] = {
        "count": stats["count"],
        "avgScore": stats["avgScore"],
        "rating": "excellent" if stats["avgScore"] >= 90 else "good" if stats["avgScore"] >= 80 else "fair",
    }

enriched["languagesByCategory"] = {}
for lang in report["ranked"]:
    cat = lang["category"]
    if cat not in enriched["languagesByCategory"]:
        enriched["languagesByCategory"][cat] = []
    enriched["languagesByCategory"][cat].append(lang["language"])

# Write both YAML and JSON outputs
yaml_path = os.path.join("/output", "enriched.yaml")
json_path = os.path.join("/output", "enriched.json")

with open(yaml_path, "w") as f:
    yaml.dump(enriched, f, default_flow_style=False, sort_keys=False)
print(f"Enriched YAML written to {yaml_path}")

with open(json_path, "w") as f:
    json.dump(enriched, f, indent=2)
print(f"Enriched JSON written to {json_path}")

print(f"Categories analyzed: {', '.join(enriched['categories'].keys())}")
