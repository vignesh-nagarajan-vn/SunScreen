# Campus lighting source audit — October 24, 2026

## Finding

There is enough public lamp-location data to make night routing meaningfully
different. The key discovery was following the operational layers in TAMU's
[Light Circuit Edits-2024 web map](https://www.arcgis.com/home/item.html?id=5eb1c863a69e46d38632b2146e0a662f),
rather than relying on search-engine indexing or the broken older PoleExport URL.
It references a live **Streetlight / layer 297** and the public lighting survey.
No accounts, tokens, subscriptions, messages, edits to external GIS services, or
permission bypasses were used. Read-only APIs were queried within the app's area.

The integrated model contains **7,294 spatially deduplicated lamp locations**:
5,790 from the current inventory, 1,477 additional historical survey observations,
and 27 additional OSM lamps. The raw OSM snapshot contains 30 lamps. At the pilot
15 m influence radius, mapped/estimated lit evidence rises from **0.47% to 49.45%**
of directed walkway length. Unknown coverage falls from **99.40% to 50.42%**.
Both directions of reciprocal graph edges are included in the length weighting.
These are model-coverage statistics, not measured illuminance or verified uptime.

## Sources examined and how to obtain them

| Source | Verified access / contribution | Decision |
|---|---|---|
| [TAMU Streetlight inventory](https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/Streetlight/FeatureServer/297) | Public ArcGIS point layer; 6,064 records returned for the buffered area in the final pipeline run. Layer last edited September 15, 2026. Query IDs, then download complete batches with `outSR=4326`. Filtered 30 non-existing records and 162 geometries outside the actual requested envelope; 5,790 unique locations survive filtering and 3 m deduplication. A dedicated streetlight layer is lamp evidence even where optional fixture fields are blank; blank status does not prove operation. | **Integrated**, as estimated proximity coverage. |
| [TAMU Lighting Survey](https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/survey123_e4683e97abd84e13bc7c11a35db139ec_stakeholder/FeatureServer/0) | Public query/extract view, 2,466 buffered records. Layer last edited October 12, 2021. Domain-coded sidewalk/street/parking/security/bollard types and inspection results. 1,877 eligible observations before merging; 1,477 unique additions after preferring the newer inventory. Adds about 2.5 percentage points of model coverage. | **Integrated**, only passing historical observations. A structural inspection failure is not interpreted as a lamp outage. |
| [Legacy TAMU streetlight inventory](https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/StreetlightProblem/FeatureServer/1) | Downloaded 5,067 records. Only 421 explicitly have ConstructionStatus=5 (Existing); 4,646 have no status. Only 18 confirmed-existing points are beyond 3 m of current sources. Adds **0.02 percentage points** (49.45% → 49.47%). | Excluded: marginal gain from an older snapshot, with much weaker status completeness. |
| [TAMU streetlight service requests](https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/StreetlightProblem/FeatureServer/0) | 88 requests in the area; maximum REQUESTDATE is October 15, 2021. Requested only an aggregate maximum date, not names, phone numbers, emails, comments, or technician information. | Excluded from current outage scoring: stale requests do not establish present lamp status. A maintained, recent feed linked to fixture IDs would be useful. |
| [TAMU Lighting_Layers](https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/Lighting_Layers/FeatureServer) and [circuit survey](https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/survey123_491e2413636c4eb095e0753244af1a09_stakeholder/FeatureServer/0) | Public circuits, panel boards, junction boxes, and survey infrastructure. The earlier audit counted 1,728 circuit features, 1,241 junction boxes, and 185 panel boards overall; circuit survey has 120 points in the campus box. | Discovery/context only. Buried wire geometry, energized service areas, or junction boxes cannot be turned into light-emitting fixtures. The circuit map was useful because it linked to the actual lamp inventory. |
| [Older Lighting Level Survey map](https://www.arcgis.com/home/item.html?id=0e535ab0741945359c1124a5926598f0) | The map still references PoleExport and LIGHTING_MEASUREMENT_SURVEY, but those service URLs and their referenced item IDs are invalid/inaccessible. | Not a usable current photometric feed. Retain as a lead for requesting measured lux data from Facilities Analytics & Mapping. |
| [lighting_samples](https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/lighting_samples/FeatureServer/0) | Live schema contains light intensity, uniformity, and perception fields; **zero records** in the app area. | Excluded: an interesting schema is not data. |
| [Areas with suboptimal lighting](https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/Areas_with_suboptimal_lighting/FeatureServer/0) | Public polygon layer; **zero features** in the app area. | Excluded. |
| [Research Park student surveys](https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/ResearchParkSurvery_BLD/FeatureServer/0) | Previously verified 15 lamp points; another survey contains 11. Small, older student surveys with partial coverage near the edge of the routing area. | Superseded by much larger campus inventory/survey; not independently imported or double-counted. |
| [OpenStreetMap](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dstreet_lamp) | `highway=street_lamp` and highway `lit` tags, via cached Overpass query or OSM map API. Existing app snapshot: 30 lamps and 15 supported tagged ways. | **Retained** for path-level lit/unlit evidence and unique lamps. ODbL with attribution. |
| [College Station public electric GIS](https://gis.cstx.gov/csgis/rest/services/_PublicUse/PublicUse_ELE/MapServer) and [open GIS catalog](https://www.cstx.gov/business-development/maps-and-gis/) | The publicly advertised electric service contains a utility service-territory polygon, not lamp fixtures. OpenData/PWS/ITS/PKS and public directories were inspected. | No verified public lamp export in inspected services. Ask city GIS/College Station Utilities for its fixture inventory and recent outage timestamps. A service-territory boundary provides no lighting coverage. |
| [Bryan Texas Utilities](https://www.btutilities.com/sites/default/files/pole-attachment-and-wireless-installation-standards-v3.0.pdf) | Official documentation confirms maintenance of streetlights. The [2025 TEES LED retrofit report](https://oaktrust.library.tamu.edu/server/api/core/bitstreams/d1dcc322-fdab-475b-8aa0-ab8ec62b6cac/content) documents utility contacts and retrofit counts. | Request-only lead for off-campus coverage. Counts and construction standards are not coordinates; no verified local fixture export was found. |
| [TxDOT Open Data](https://www.txdot.gov/manuals/des/tsp/chapter-2-data-collection/2-3-existing-data-sources/2-3-4-txdot-open-data-portal.html) / roadway lighting assets | Roadway inventory, design standards, and outage-monitoring projects exist. Catalog searches did not yield a verified campus fixture layer. | Potential highway/perimeter supplement, not demonstrated useful within current campus graph. Do not equate road class or traffic signals with illumination. |
| [Mapillary point map features](https://help.mapillary.com/hc/en-us/articles/360021883552-Exploring-point-map-features-with-the-Mapillary-web-app) | Computer-vision-derived streetlight points are supported. [GeoJSON download](https://help.mapillary.com/hc/en-us/articles/4407521157138-Downloading-map-data-via-the-Mapillary-web-app) requires login; API/SDK uses an access token. [Derived metadata terms](https://help.mapillary.com/hc/en-us/articles/115001777705-OpenStreetMap-compatibility) distinguish metadata from image licensing. No user account/token was available, so local feature counts were not verified. | Promising future off-campus supplement, but **not integrated** without verified local coverage. Use triangulated map features, not camera GPS as lamp coordinates. |
| [Google Earth infrastructure / streetlights](https://developers.google.com/maps/documentation/earth/infrastructure-data) | Google now offers an actual Street View-derived streetlight dataset in the US. The [catalog](https://developers.google.com/maps/documentation/earth/available-data-layers) lists it under Professional Advanced. It is a potential licensed source, distinct from raw Google Maps scraping. | No account, plan, campus completeness, export permission, or machine-readable licensed feed verified. Not integrated. [Maps terms](https://cloud.google.com/maps-platform/terms) restrict scraping and creating content from Maps content; do not build an independent fixture database by scraping imagery. |
| [Panoramax](https://docs.panoramax.fr/backend/api/api/) / [KartaView](https://kartaview.org/) | Street-level image alternatives. Panoramax has a federated STAC/OGC API and per-instance/image licensing. The public metacatalog query failed TLS negotiation in this environment; campus coverage remains **unverified**, not zero. KartaView was identified as an imagery lead; no local lamp inventory was verified. | No production import. Human review or a locally validated multi-view detection/geolocation workflow would be required; imagery alone is not fixture coordinates or present brightness. |
| [USGS/USDA NAIP](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip) and [city aerial imagery](https://gis.cstx.gov/csgis/rest/services/_Imagery) | Public NAIP is typically 0.6 m, with 0.3 m options; USGS downloads via EarthExplorer. City catalog has 2021, 2024, and 2025 aerial services. Daytime imagery can corroborate poles/shadows or train a reviewed detector. | Useful QA/future collection source, **not automatic new lamp evidence**. Trees, signs, utility poles and bollards cause false positives, and daylight pixels do not measure nighttime lighting. No validated detector was demonstrated. |
| Existing [TxGIO / USGS LiDAR](https://www.usgs.gov/faqs/what-lidar-data-and-where-can-i-download-it) | Raw point clouds can reveal vertical structures, but the existing 1 m terrain/surface rasters are not a semantic light-pole inventory. [USGS notes](https://www.usgs.gov/ngp-standards-and-specifications/lidar-base-specification-glossary) that intensity is reflected laser energy, not ambient light. | Reuse for future occlusion/geometry QA or supervised pole extraction. Do not interpret LiDAR intensity or generic poles as nighttime brightness. Not imported as light points. |
| [NASA Black Marble / VIIRS](https://viirsland.gsfc.nasa.gov/Products/NASA/BlackMarble.html), DMSP, higher-resolution nighttime missions | Standard Black Marble is on a 15 arc-second grid (roughly 500 m); radiance includes buildings, roads, sports lighting and reflections. Higher-resolution specialty/commercial imagery would need a verified local scene and usable license; none was verified here. | Regional context, not discrimination between nearby sidewalks. No satellite pixels were converted into streetlight points. |
| [As-built electrical / photometric plans](https://assets.system.tamus.edu/files/fpc/pdf/DeveloperProjectGuidelines2025.09.01.pdf) | TAMU System submission requirements include electrical and photometric plans. Public project-specific diagrams, such as [Penberthy](https://transport.tamu.edu/WebFS/Transport/Projects/2025/Penberthy-Schematic-1.pdf), contain planned light symbols. | Worth requesting **as-built** plans, CAD/GIS export, IES files and commissioning measurements. Proposed symbols do not establish installed fixtures; PDF georeferencing and installation verification would be needed. No speculative proposed fixtures were imported. |
| Field surveys / facilities work orders / campus safety walks | Own geotagged nighttime observations, lux measurements and current maintenance records would directly validate the model. Requires field collection or a maintained institutional export. | Best next validation step. No synthetic observations, external messages, or fabricated measurements were generated. |

This is a broad audit of discoverable source families, not a claim to have proved
that no other unindexed, private, or newly published dataset exists.

## Measured routing contribution

The same graph and routing penalties were used; only lamp evidence changed.
`route-impact.json` records the checked trips. These are estimates using a uniform
15 m radius, not claims of measured lighting levels.

| Trip | Fastest estimated/mapped lit | Recommended estimated/mapped lit | Extra time |
|---|---:|---:|---:|
| Commons → Zachry | 97% | 97% | 0 s |
| MSC → Evans | 92% | 97% | 12 s |
| Sbisa → MSC | 82% | 93% | 25 s |
| Rec → Zachry | 93% | 94% | 3 s |
| Kyle Field → Blocker | 88% | 92% | 27 s |
| Wehner → Commons | 95% | 98% | 13 s |

For Northgate → Commons, the recommended route remains fastest with only 53%
estimated coverage; the longer Most lit option reaches 70%. Off-campus uncertainty
remains material. In five of the seven audited trips, the lighting recommendation
changes the path. Daytime shade routing is independent and remains unchanged.

## Implementation and reproducibility

- `pipeline/lighting_sources.py`: bounded public ArcGIS downloads, selected physical
  fields only, complete ID-based paging, area/schema-keyed 30-day caches, atomic
  cache replacement, exclusions, source dates, and deduplication.
- `pipeline/05_lighting.py`: combines those points with the OSM data before sampling
  the existing graph. `--osm-only` provides an intentional baseline.
- Removed/non-existing inventory locations suppress older survey/OSM positives
  within 3 m. Sign-only poles, invalid/out-of-envelope geometries, unsupported
  survey types and non-passing inspections do not contribute positive evidence.
- Blank optional inventory attributes do not mean a fixture is removed. Numeric
  zero fields are often defaults and are not interpreted as proven zero fixtures.
- Lamp points yield **estimated**, never mapped/measured, lighting along paths.
  OSM `lit` tags remain the separate mapped category. Unknown stays unknown.
- Per-source terms/provenance stay separate. Campus raw caches are not relabeled
  as ODbL. No requestor, inspector, contact, feeder, or circuit data is needed.
- Source access and the coordinate/route impact were verified with public API
  requests. Actual operating condition, fixture photometry, obstructions and
  nighttime brightness still require field validation.

Run from the repository root with the pipeline Python environment:

```sh
python pipeline/05_lighting.py              # cached if the area/schema and age match
python pipeline/05_lighting.py --refresh    # refresh OSM and campus snapshots
python -m unittest discover -s tests -v
make bake                                 # regenerate both offline route modes
```

Restart the API after regenerating the graph. `measure_sources.py`, the saved
metadata summaries, `contribution.json`, `legacy-contribution.json`, and
`route-impact.json` preserve the audit evidence. Cached physical fixture snapshots
are local research artifacts; no third-party service was edited.

## Access and reuse limitation

The two TAMU layers allow anonymous public queries, and this was verified. Their
item terms/license fields are blank: **that is not an explicit open-data license**.
This local integration preserves source URLs and attribution and does not claim
the campus observations are ODbL. Obtain clear TAMU redistribution terms before
publishing those source snapshots or distributing a combined database. OSM's
separate ODbL obligations remain applicable to its portion/derived graph. No public
deployment or external database publication was performed in this task.

## Recommendation

Continue with the campus inventory integration and validate representative routes
at night. It is worth doing now; lack of OSM coverage no longer blocks a useful
prototype. Building an unvalidated Google/NAIP/LiDAR pole detector is lower-value
than checking the thousands of actual campus lamp observations, improving
occlusion/fixture models, and obtaining current outage/photometric data.
