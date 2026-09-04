# HomeHub v0.16.2 release

## Render build hotfix

A v0.16.1 Render buildje TypeScript fordítási hibával megállhatott az automation API `tuya.command` action sémájánál. A Zod `z.any()` a `value` mezőt TypeScriptben opcionálisnak inferálta, miközben az `AutomationAction` típus kötelező `value` mezőt ír elő.

A v0.16.2 a parancsértéket explicit Tuya/JSON primitívként validálja (`string | number | boolean | null`), ezért az input schema és az `AutomationAction` típus újra konzisztens.

A Feyree töltési állapot és a myGate világítás v0.16.1 javításai változatlanul benne vannak. A WD médiafunkciók és Bridge működése nem változott.
