# Floor-plan extraction corpus report

| fixture | category | annotation | status | s | rooms | walls P/R | rooms det. / IoU | label acc. | type acc. | doors P/R | windows P/R | scale err | partial (rooms / types / labels) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| e2 | e2 | full | ok-with-warnings | 4.7 | 9 | 100 % / 96 % | 90 % / 0.987 | 100 % | 100 % | 100 % / 90 % | 100 % / 100 % | 0.04 % | — |
| synthetic-angled | synthetic | full | ok-with-warnings | 0.8 | 2 | 100 % / 100 % | 100 % / 0.996 | 100 % | 100 % | 100 % / 100 % | 100 % / 100 % | 0.25 % | — |
| synthetic-corridor | synthetic | full | ok-with-warnings | 1.1 | 9 | 100 % / 100 % | 100 % / 0.997 | 100 % | 89 % | 100 % / 100 % | 100 % / 100 % | 0.21 % | — |
| synthetic-mm | synthetic | full | ok-with-warnings | 1.3 | 5 | 100 % / 100 % | 100 % / 0.982 | 100 % | 100 % | 100 % / 100 % | 100 % / 100 % | 0.82 % | — |
| blank | pathological | qualitative | failed | 0.1 | 0 | — | — | — | — | — | — | — | — |
| e2-low-res | pathological | full | needs-review | 2.1 | 8 | 91 % / 83 % | 70 % / 0.917 | 80 % | 86 % | 100 % / 70 % | 100 % / 100 % | 2.73 % | — |
| e2-scan | pathological | full | needs-review | 27.8 | 13 | 85 % / 88 % | 70 % / 0.862 | 100 % | 71 % | 80 % / 40 % | 23 % / 75 % | 10.31 % | — |
| noise | pathological | qualitative | failed | 0.1 | 0 | — | — | — | — | — | — | — | — |
| synthetic-mm-photo | pathological | full | needs-review | 9.1 | 6 | 89 % / 89 % | 60 % / 0.869 | 0 % | 0 % | 33 % / 20 % | 29 % / 50 % | 7.17 % | — |
| ballymun-flat-1965 | real-world | qualitative | failed | 15.4 | 212 | — | — | — | — | — | — | — | 13.25 / 0 % / 43 % |
| bungalow-2bhk | real-world | partial | needs-review | 8.4 | 8 | — | — | — | — | — | — | — | 0.8 / 86 % / 100 % |
| coloured-3d-render | real-world | qualitative | failed | 7.2 | 19 | — | — | — | — | — | — | — | — |
| floor-plan-01 | real-world | qualitative | failed | 24.3 | 114 | — | — | — | — | — | — | — | — |
| grove-1bed-flat | real-world | partial | needs-review | 1.2 | 16 | — | — | — | — | — | — | — | 2 / 20 % / 71 % |
| grove-2bed-flat | real-world | partial | needs-review | 1.5 | 10 | — | — | — | — | — | — | — | 1 / 33 % / 63 % |
| grove-3bed-flat | real-world | partial | needs-review | 1.4 | 27 | — | — | — | — | — | — | — | 2.25 / 50 % / 43 % |
| hk-greenview-2bed | real-world | qualitative | needs-review | 6.9 | 1 | — | — | — | — | — | — | — | — |
| kitchen-remodel-before | real-world | partial | needs-review | 5.4 | 9 | — | — | — | — | — | — | — | 1.13 / 67 % / 40 % |
| massachusetts-ave-apartments | real-world | partial | needs-review | 14.2 | 133 | — | — | — | — | — | — | — | 3.33 / 43 % / 25 % |
| plan-appartement-fr | real-world | partial | needs-review | 2.8 | 10 | — | — | — | — | — | — | — | 1.25 / 25 % / 100 % |
| plattenbau-p2 | real-world | partial | needs-review | 0.9 | 2 | — | — | — | — | — | — | — | 0.2 / 17 % / 89 % |
| schmidt-lademann-house | real-world | partial | needs-review | 10.9 | 8 | — | — | — | — | — | — | — | 0.44 / 33 % / 90 % |
| t-plus-128sqft-flat | real-world | partial | needs-review | 6.5 | 1 | — | — | — | — | — | — | — | 0.5 / 0 % / — |
| tyneside-flat | real-world | partial | needs-review | 2.5 | 8 | — | — | — | — | — | — | — | 0.57 / 60 % / 100 % |

## Problems by category (fixtures affected / total problems)

- wall_detection: 15 / 15
- room_detection: 13 / 42
- room_boundary: 13 / 155
- room_label: 17 / 447
- room_classification: 6 / 11
- door_detection: 19 / 1022
- window_detection: 8 / 34
- scale: 23 / 23
- annotation_conflict: 15 / 30
- image_quality: 2 / 4
- structural_ambiguity: 4 / 4

## Expectation checks: 95 passed, 0 failed
