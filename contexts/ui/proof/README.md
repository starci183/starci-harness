# Proof data

Data the proof lenses read. The reasoning is [../proof.md](../proof.md).

| File | Holds | Read by |
| --- | --- | --- |
| [thresholds.yaml](thresholds.yaml) | every numeric threshold of `contexts/ui` (`starci/ui-thresholds@1`), keyed by fact and bound to its rule ids | proof briefs and gates, the draw critic, an auditor citing a number |
| [anchor-low.html](anchor-low.html), [anchor-mid.html](anchor-mid.html), [anchor-high.html](anchor-high.html) | the three calibration sheets; their expected bands are `calibration.anchors` in thresholds.yaml | the scorer of TASTE and UX, every round |

A gate reads a threshold by key and never parses a number out of prose. Changing a number is a change to this
file only.
