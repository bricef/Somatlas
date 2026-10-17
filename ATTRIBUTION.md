# Attribution and licences

## Anatomy models (`public/packs/`)

Adapted (converted, repaired, simplified and compressed) from:

- **BodyParts3D**, © The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan. <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/>
- **Z-Anatomy**, the libre 3D atlas of anatomy, CC BY-SA 4.0. Gauthier Kervyn (design, 3D, anatomy), Marcin Zielinski (Blender scripts) and contributors. <https://github.com/Z-Anatomy/Models-of-human-anatomy> (commit `a37dbd9`)

Somatlas's adaptations are released under **CC BY-SA 4.0**.

The generated `hull.glb` (body outline) and the lung volumes in `organs.glb` are derived from the meshes above and carry the same licence.

### Possibly non-commercial models (`*-nc.glb`)

Z-Anatomy bundles third-party models under non-commercial licences, including *Anatomy of the Inner Ear* (University of Dundee School of Medicine, CC BY-NC-SA 4.0) and *Kidney* (Lissie Cowley, CC BY-NC 4.0). The source file does not record which objects came from them, so structures that might are kept in separate `*-nc.glb` packs and are flagged in the registry. Use them for non-commercial purposes only. Somatlas is non-commercial.

Z-Anatomy also credits *Cranial Nerves and Foramina* (University of Dundee, CAHID, CC BY 4.0).

## Descriptions (`public/content.json`)

Z-Anatomy definitions, which draw heavily on Wikipedia (CC BY-SA). Released here under CC BY-SA 4.0.

## Terminology

Latin names and TA2 identifiers from the Terminologia Anatomica 2 table distributed with Z-Anatomy (`TA2.csv`).

## X-ray attenuation data (`src/xray/attenuation.ts`)

Mass attenuation coefficients from the US National Institute of Standards and Technology (NIST), *X-Ray Mass Attenuation Coefficients*, Table 4, for ICRU Report 44 tissue compositions. <https://pml.nist.gov/PhysRefData/XrayMassCoef/tab4.html>

## Code

The application code's licence is still to be decided (PRD §16).
