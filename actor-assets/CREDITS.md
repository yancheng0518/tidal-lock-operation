# Tidal Lock character art

The security guards use **Military tactical suit (LowPolyGameReady)** by **DanlyVostok**.
[Original model](https://sketchfab.com/3d-models/military-tactical-suit-lowpolygameready-ef698ce36b1545a78ce592dd3db4c7ed) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Animation poses and cycles were prepared from the [3d-fps redistribution](https://github.com/cktang88/3d-fps/tree/130ac2a5c856401ec36e7d35afcfefe40c5801f4/public/assets/models/characters). The source reference rig is **FREE [Military Soldier] RIGGED** by **BAMEN** ([original model](https://sketchfab.com/3d-models/free-military-soldier-rigged-e9c56308a67d4a3db62e914fafa4d198), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Reference stance and fall motion originate in **Quaternius Universal Animation Library**, [CC0](https://quaternius.com/packs/universalanimationlibrary.html). Directional locomotion originates in **100STYLE** by **Ian Mason, Sebastian Starke and Taku Komura** ([dataset](https://zenodo.org/records/8127870), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).

For this demo the suit meshes were combined, materials and normal maps were atlased, and seven selected animation layers were retargeted to the suit. The simplified fallback guard uses an original carried prop.

The bundled glTF loader comes from the Three.js project and is covered by the MIT license in ../vendor/LICENSE.

## First-person equipment

The first-person carbine exterior uses [M4A1](https://sketchfab.com/3d-models/m4a1-40d8ef818c7549a896371cbb1f64fec6) by **Firewarden**. The sleeves and gloves use [Fps arms](https://sketchfab.com/3d-models/fps-arms-9452ce4cddde4110a4fd73e555a8e412) by **bumstrum (DJMaesen)**. The armature and static hold derive from [FPS AK-74m animations](https://sketchfab.com/3d-models/fps-ak-74m-animations-94be8385c402474cacd39bc096c6ca14) by **ccransh**. The sight housing uses [EoTech EXPS3-0 Holographic Weapon Sight Lowpoly](https://sketchfab.com/3d-models/eotech-exps3-0-holographic-weapon-sight-lowpoly-45e4fcdfb1b34756ab9e866564a12f66) by **valterjherson1**. Each is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

These locally bundled meshes derive from the [3d-fps adaptation at revision 130ac2a](https://github.com/cktang88/3d-fps/tree/130ac2a5c856401ec36e7d35afcfefe40c5801f4/public/assets/models). Its adaptation posed and rigged the hands, removed markings, baked ambient occlusion and converted the textures. For Tidal Lock, the exterior and hands were repacked into a self-contained glTF, the sight and carried model were simplified, and the surface finish, optical overlay, hand motion and carry animation were adapted to the demo.
