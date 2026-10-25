"""Read-only public GIS audit; keeps only lamp attributes, not personal fields."""
import asyncio
from collections import Counter
import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent
SOURCES = [
    ("tamu_streetlight", "https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/Streetlight/FeatureServer/297", "FID", "FID,POLE_HEIGH,POLE_TYPE,Pole_Use,Status,Verified,Condition,Number_Fix,FixtureTyp,LampType,Wattage,EditDate"),
    ("tamu_survey", "https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/survey123_e4683e97abd84e13bc7c11a35db139ec_stakeholder/FeatureServer/0", "ObjectId", "ObjectId,field_4,field_5,field_7,field_8,field_14,field_15,field_51,field_52,field_53,field_54,field_56,field_57,EditDate"),
]


async def main():
    semaphore = asyncio.Semaphore(4)
    async with httpx.AsyncClient(timeout=45, follow_redirects=True) as client:
        async def get(url, params):
            for attempt in range(3):
                try:
                    async with semaphore:
                        response = await client.get(url, params=params)
                    response.raise_for_status()
                    result = response.json()
                    if result.get("error"):
                        raise ValueError(result["error"])
                    return result
                except Exception:
                    if attempt == 2:
                        raise
                    await asyncio.sleep(2)

        for name, url, oid, fields in SOURCES:
            ids = (await get(url + "/query", {
                "where": "1=1", "returnIdsOnly": "true", "f": "json",
                "geometry": "-96.3582,30.5917,-96.3311,30.6299", "geometryType": "esriGeometryEnvelope",
                "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
            }))["objectIds"]
            async def page(batch):
                result = await get(url + "/query", {
                    "objectIds": ",".join(map(str, batch)), "outFields": fields,
                    "outSR": 4326, "returnGeometry": "true", "f": "json",
                })
                if result.get("exceededTransferLimit"):
                    raise ValueError("Truncated source response")
                return result.get("features", [])
            pages = await asyncio.gather(*(page(ids[i:i+100]) for i in range(0, len(ids), 100)))
            features = [feature for batch in pages for feature in batch]
            if {f["attributes"][oid] for f in features} != set(ids):
                raise ValueError("Source IDs do not match downloaded records")
            (ROOT / (name + "-points.json")).write_text(json.dumps({
                "url": url, "object_id_field": oid, "expected": len(ids), "features": features,
            }), encoding="utf-8")
            counts = {field: Counter(str(f["attributes"].get(field)) for f in features).most_common(12)
                      for field in fields.split(",") if field not in (oid, "EditDate", "field_14", "field_57")}
            print(json.dumps({"source": name, "expected": len(ids), "received": len(features), "attributes": counts}))


if __name__ == "__main__":
    asyncio.run(main())
