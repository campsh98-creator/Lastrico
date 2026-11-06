# Road-surface image datasets — legal and quality survey (Phase 4.20, Agent B)

Survey date 2026-11-05. Machine-readable version: `datasets.json`.

**Method.** Dataset records, papers and licence pages were read, and Zenodo, GitHub and Hugging Face APIs were queried for metadata and file listings. RoadSaW sizes came from HTTP `HEAD` requests. **No image archive, label file or model weight was downloaded.** Evidence tags:
**[P]** checked in this run on the primary source (dataset record, its paper, licence page or API);
**[S]** checked only in a secondary source;
**[I]** inferred from checked facts;
**[U]** could not be checked.

## Summary

| Dataset | Licence | Labels | Pavé class | Smallest usable download | Geography | Per-image coords | Verdict |
|---|---|---|---|---|---|---|---|
| **StreetSurfaceVis V1.0** | CC BY-SA 4.0 [P] | Human, 3 annotators, α=0.96 type [P] | `sett` (1,363) [P] | `s_1024.zip` 1,283,338,088 B + CSV 967,208 B [P] | Germany only [P] | Yes (lat/lon, user, time) [P] | **Recommended** |
| Cycling Street Surface | CC BY-SA 4.0 [P] | Author-annotated, no protocol [P] | `sett` [P] | 6,305,216 B [P] | Not documented (Münster? [I]) | Not documented [U] | Optional later |
| RTK (UFSC) | **No licence stated** [P] | Human, by the authors [P] | No (`paved` lumps all) [P] | Many parts, sizes not shown | Santa Catarina, Brazil [P] | No [P] | Reject |
| RSCD (Tsinghua) | CC BY-NC [S] | Human [S] | No (asphalt, concrete, mud, gravel) [P] | ~1 M patches | Beijing [P] | Not mentioned | Reject |
| RoadSaW (VISCODA) | **CC BY-NC-SA 4.0** [P] | Wetness from sensor; surface classes as published [P] | `cobblestone` [P] | `RoadSaW-CtD1.zip` 219,961,254 B; base sets 1.4–14.6 GB [P] | Not stated [P] | Not mentioned [P] | Reject (NC, bird's-eye patches) |
| Mapillary Vistas v2.0 | Research licence, NC per secondary sources [S] | Human segmentation [S] | No material classes [S] | — | Global | Yes | Reject |
| Mapillary + OSM tags | Images CC BY-SA, tags ODbL [S] | Weak labels: OSM matched human type only 69% of the time [P] | Weak | Needs an API token (owner account) | Global, Milan included | Yes | Reject for training |
| KITTI | CC BY-NC-SA 3.0 [P] | No material labels [I] | No | — | Karlsruhe | Yes | Reject |
| Cityscapes | Custom: non-commercial, no redistribution [P] | No material labels [P] | No | — | 50 cities, mostly Germany | No | Reject |
| Rome road-damage (Sci Rep 2026) | Not checked [U] | Damage boxes [S] | No | — | Rome, Italy [S] | ? | Reject |
| IRD (Baghdad), NAIP aerial, Sentinel-2+OSM | CC BY / CC BY [P/S] | Defects / aerial / weak | No | — | Iraq / USA / satellite | — | Reject |

## StreetSurfaceVis V1.0: recommended

- **Record and licence [P].** Record: https://zenodo.org/records/11449977 (DOI 10.5281/zenodo.11449977, V1.0, 2024-06-04). The licence field is `cc-by-sa-4.0`. The latest-version endpoint still resolves to V1.0.
- **Paper [P].** Kapp, Hoffmann, Weigmann, Mihaljević, *Sci Data* 12, 92 (2025), doi:10.1038/s41597-024-04295-9. The article is CC BY 4.0; I read the full text through Europe PMC (PMC11739464).
- **Image licence.** The paper says the dataset is CC BY-SA "in accordance with Mapillary's CC-BY-SA licensing for user-generated images". It also says the licence requires attribution to each image's creator: each image's `mapillary_image_id` and `user_name` are in the CSV. Mapillary's terms forbid reversing face and plate blurring. The Mapillary help page returned HTTP 403, so the Mapillary licence is only checked through the paper [S].
- **Labels [P].** Every image is labelled by hand by one of three trained annotators, following a written labelling guide. Pre-selection was done with OSM tags, CNN pseudo-labels, GPT-4o prompts and embedding search. These tools only proposed candidates; they did not set the final labels.
- **Annotator agreement [P].** 180 images (10 per pre-label class) were rated by all three annotators. 61 of them (12 sent for revision, 49 discarded) were left out of the calculation. Krippendorff's α is 0.96 for surface type and 0.74 for quality.
- **Discrepancy [P].** The Zenodo text says 1,800 images were triple-annotated. 1,800 is also the size of the OSM pre-label batch (100 × 18), so the paper's 180 is taken as authoritative. The Zenodo table also says asphalt-good = 1,697, which gives a total of 9,123; the paper's 1,696 matches the stated total of 9,122.
- **Classes [P].** Asphalt 3,734, concrete 972, paving_stones 2,037, sett 1,363 (good 129, intermediate 694, bad 540), unpaved 1,016. Total 9,122.
- **`sett` definition [S/I].** The paper defines `sett` as "regular-shaped cobblestone". The labelling guide only describes sett by quality level; I found no explicit treatment of unhewn cobblestone.
- **Sampling [P].** At most 5 images per zoom-14 tile (about 1.5 km) and 10 per sequence. Selection was steered towards target classes, so class frequencies in the dataset are not real-world frequencies.
- **Official test split [P].** 776 images from the urban areas of five German cities, flagged `train=False`; the cities are not named. Test images per class: asphalt 530, concrete 16, paving_stones 113, **sett 32**, unpaved 85.
- **Published reference result [P].** EfficientNetV2-S reaches test accuracy 0.91. For sett: precision 0.88, recall 0.92, F1 0.90. Concrete F1 is only 0.35.
- **Transfer within Germany [S].** The SurfaceAI pipeline paper (arXiv 2409.18922) reports type accuracy 0.76 and paving-stones F1 0.58 in a rural municipality, using a model trained on urban images.
- **Coordinates [P].** `latitude`, `longitude`, `user_id`, `user_name`, `captured_at` and `train` are in the CSV. A sequence id is not.
- **Viewpoint [P].** Crowdsourced street-level photos (Mapillary app or other devices; taken from a car, a bicycle or on foot). Roadways, cycleways and footways are all included. The label describes the focal road at the bottom centre of the image; the authors recommend cropping x∈[0.25W, 0.75W], y∈[0.5H, H].
- **Files [P]** (Zenodo API; URL pattern `https://zenodo.org/api/records/11449977/files/<name>/content`):

  | File | Bytes | MD5 |
  |---|---:|---|
  | streetSurfaceVis_v1_0.csv | 967,208 | a6ac6ab1edf7d813ebe7ffb22b922423 |
  | s_256.zip | 99,052,992 | d2beab4af8f3995bc8789ba27645ddc0 |
  | **s_1024.zip** | **1,283,338,088** | 3a32ab4f5f2992a267c4274179717c77 |
  | s_2048.zip | 4,476,691,714 | 909b5cb41de03b74f8e09a0c714b9af3 |
  | s_original.zip | 18,531,480,454 | f2d5a490702b3024f1e4c81080b9c0e1 |
  | labeling_guide.pdf / dataset_description.pdf / Datasheet…pdf | 2,213,538 / 621,208 / 118,336 | — |

- **Which variant is the smallest usable one [P/I].** SurfaceAI's own pipeline (`configs/00_global_config.json`) uses 1024-px thumbnails, crops the lower-middle half and resizes it to 384 px. In `s_256` that crop is only about 128×96 px, which is smaller than this pipeline's 256×192 working size, so sett joints would be mostly lost. `s_1024` is therefore the smallest variant I expect to be usable. `s_256` (99 MB) remains a cheap fallback (`--variant 256`).
- **Licence fit for Lastrico [I].**
  - Training offline is allowed. The CC FAQ says CC licences cover any use that needs copyright permission, and AI training needs no special permission.
  - Whether trained weights or their outputs count as an "Adaptation" depends on national law. Policy: images and weights never go into the MIT repository, and any weights that are ever published are released as CC BY-SA 4.0 with attribution, separately from the MIT code.
  - Never push model-derived surface tags to OSM.
  - Mixing CC BY-SA-derived predictions with ODbL data in one public database needs legal review before any integration.

## Other candidates

- **Cycling Street Surface Dataset** (DOI 10.5281/zenodo.17838875, 2025-12-05, CC BY-SA 4.0) [P].
  - Classes: asphalt, paving stone, sett and unpaved, from a bicycle-mounted OV2640 camera; crops of 96×96 and 48×192 px.
  - One file: `cycling_street_surface_dataset.zip`, 6,305,216 B, MD5 c2011eaa1b4086a4acc2b2b826e7dfea.
  - Class counts, location, coordinates and labelling protocol are not documented, and Zenodo would not preview the archive listing.
  - It could later serve as a cross-viewpoint sanity check. It is not proposed for phase 2.
- **RTK** [P]. The UFSC project page states no licence, only a citation request, so the default is "all rights reserved".
  - Frames are labelled asphalt (43,263), paved (13,697) and unpaved (5,702); "paved" mixes every non-asphalt pavement.
  - Video comes from a webcam in Santa Catarina, Brazil, with no coordinates.
  - The StreetSurfaceVis paper notes that RTK-trained models generalise poorly.
- **RSCD.** About 1 million bonnet-camera patches from Beijing [P]. Material classes are asphalt, concrete, mud and gravel; there is no sett class [P]. The author site states CC BY-NC [S].
- **RoadSaW.** Licence CC BY-NC-SA 4.0 [P]. Classes are asphalt, cobblestone and concrete × 4 wetness levels, as bird's-eye projected patches [P]; neither location nor coordinates are stated [P]. Sizes from HEAD requests [P]: `RoadSaW-075_s.zip` 3,183,408,002 B, `RoadSaW-300_s.zip` 1,440,048,808 B, `RoadSaW-075_l.zip` 14,623,716,971 B, `RoadSaW-CtD1.zip` 219,961,254 B. The NonCommercial clause and the projected viewpoint rule it out for Lastrico.
- **Mapillary Vistas v2.0.** 124 classes (Road, Sidewalk, Pothole, Manhole, …) and no material classes [S, from the mmsegmentation class list]. The licence is reported as non-commercial research [S].
- **Mapillary + OSM weak labels.**
  - In StreetSurfaceVis's own measurement, OSM pre-labels matched human surface-type labels in only 69% of cases [P].
  - Training on these labels would teach the model to repeat OSM, the same source Lastrico already uses and that Phase 4.17 found insufficient.
  - The Mapillary API needs a token tied to an owner account.
  - In the repository, `data/surfaces/milan-central.json` has 33 OSM objects tagged `mapillary=*`: 8 unique image ids, all `surface=asphalt`.
  - Useful later only as a source of Milan photos for a **human-labelled** Italian evaluation set.
- **KITTI** is CC BY-NC-SA 3.0 [P] and **Cityscapes** has a non-commercial licence that also bars redistribution [P]. Neither has surface-material classes (Cityscapes label list [P], KITTI [I]).
- **Italy.** The only Italian street imagery found is the Rome road-damage dataset (Giordani et al., *Sci Rep* 2026, doi:10.1038/s41598-026-46679-4): potholes, cracks and manholes [S], with no surface type. No public Italian dataset with labelled pavé, porfido or sampietrini was found.
- **Related assets (not datasets).**
  - SurfaceAI weights: `SurfaceAI/models-moved` on Hugging Face, with `v1/surface_type_v1.pt` at 81,630,118 B. They need torch 2.2.2 and the model card states **no licence** [P]. Not downloaded; the licence would need clarifying with surface-ai@htw-berlin.de.
  - HeiGIT benchmark code: Zenodo 15497076, MIT [P].
  - SmartRoadSense (Italian roughness aggregates, ODbL) [P]: not imagery, but relevant to the roughness-sensor experiment.
