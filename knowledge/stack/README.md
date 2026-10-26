# Stack

The libraries and versions every app uses. Data a machine reads; the reasoning for using a library lives in the
pattern its concern names.

| File | Holds | Read by |
|---|---|---|
| [fe.yaml](fe.yaml) | per front-end concern: the one library, its home slots, the pattern that teaches it, the forbidden alternatives | the canon lint (`fe-stack-import`, R244; unlisted dependencies, R288), the scaffolder, an agent adding a dependency |
| [pins.yaml](pins.yaml) | the exact version of every shared dependency and base image | the pin gate, the scaffolder and upgrades, [vendor](../vendor/README.md) for the HeroUI version |

A back end's libraries are decided inside its patterns (raw-library owners are `ruleParams.be.infraOwners` in
[hfs/slots.yaml](../hfs/slots.yaml)); there is no `be.yaml` yet. A version is raised here first, then each app moves
in its own upgrade. A new front-end concern adds one row to `fe.yaml`; a topic in `patterns/fe` exists only when
using the library still leaves a decision.
