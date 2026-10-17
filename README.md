# Somatlas

A free, browser-based, interactive 3D atlas of the human body.

> **Status: planning.** There is nothing to run yet. Start with the [product requirements document](docs/prd.md).

## What it will do

Somatlas is one explorable body:

- **Explore.** Rotate the body, peel back its layers and cut through it with a section plane.
- **Drill down.** Hotspots lead from the whole body to each organ system, then to organs and their parts.
- **X-ray it.** Choose exactly which structures to scan, place a virtual X-ray source anywhere, and see a radiograph calculated from the anatomy models in real time.
- **Learn.** Read short, sourced descriptions, watch process animations (heartbeat, breathing, digestion and more), and test yourself with a quiz played on the model.
- **Share.** Every view can be reproduced from a URL. The app works offline once loaded.

It is inspired by 1990s anatomy CD-ROMs such as DK's *The Ultimate Human Body*, but is built from scratch with open data and original content. Somatlas is not affiliated with or endorsed by DK.

## Principles

- **Free and non-commercial.** No ads, no paid tiers, no accounts, no trackers.
- **Complete anatomy.** The human body is shown in full, without censorship, in a neutral and educational way.
- **Open and attributable.** Every asset has a recorded source and licence, and the build checks this.
- **Define once, derive interfaces.** Anatomical structures and user actions are each defined once, in a structure registry and an operation registry. Hotspots, search, the quiz, URLs, keyboard shortcuts and other surfaces are derived from them.
- **Educational, not medical.** Nothing here is medical advice, and computed radiographs are illustrative, not diagnostic.

## Planned stack

TypeScript, Vite and Three.js (WebGL2), with anatomy delivered as compressed glTF packs. It will be a static, installable web app with no backend.

## Data sources

| Source | Used for | Licence |
|---|---|---|
| [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/) | Base 3D anatomy meshes | CC BY-SA 2.1 Japan |
| [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy) | Organised and completed meshes, definitions | CC BY-SA 4.0 (a few files CC BY-NC) |
| [OpenStax *Anatomy and Physiology 2e*](https://openstax.org/details/books/anatomy-and-physiology-2e) | Source text for descriptions | CC BY 4.0 |
| [NIST X-ray attenuation tables](https://pml.nist.gov/PhysRefData/XrayMassCoef/tab4.html) | Tissue attenuation for the X-ray scanner | US government data |
| [Visible Human Project](https://www.nlm.nih.gov/research/visible/visible_human.html) | Cross-section imagery | NLM terms and conditions |

See [§9 of the PRD](docs/prd.md#9-content-data-and-licensing) for details.

## Roadmap

| Phase | Focus |
|---|---|
| P0 | Spike: load anatomy, pick structures, prototype the X-ray pass, audit mesh quality |
| P1 | MVP: body explorer with hotspots, layers and section plane; core X-ray scanner; search and deep links |
| P2 | Contrast agents and X-ray export, quiz, process animations, pronunciations |
| P3 | Flythroughs, slice viewer, offline install, accessibility audit |

## Licensing

- **Code:** to be decided (see PRD §16).
- **Anatomy assets:** CC BY-SA 4.0. The few non-commercial files are kept separate under their own licences.
- **Original content:** CC BY-SA 4.0 (proposed).

## Links

- Website: [somatlas.org](https://somatlas.org) (coming soon)
- Product requirements: [docs/prd.md](docs/prd.md)
