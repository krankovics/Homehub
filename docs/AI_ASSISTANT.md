# HomeHub AI Assistant v0.15.0

## Architektúra

A böngésző nem kommunikál közvetlenül az OpenAI API-val. A folyamat:

```text
HomeHub UI
  -> HomeHub Render server /api/ai/*
  -> policy + context builder
  -> OpenAI Responses API
  -> structured draft / text answer
  -> HomeHub validation
  -> user approval
  -> Tuya command / WD Bridge command / AutomationRule save
```

Az `OPENAI_API_KEY` csak a Render environmentben legyen tárolva.

## AI módok

- `off`: nincs OpenAI API-hívás.
- `suggest`: chat, összefoglaló, automatizálási draft és parancsterv használható, de az AI-parancs nem hajtható végre.
- `approved`: a parancsterv külön UI-megerősítés után végrehajtható, ha a szerver policy és capability validáció is engedi.

A mód a HomeHub `settings.aiMode` része, így a WD-re mentett perzisztens state-ben is megmarad.

## API végpontok

- `GET /api/ai/status`
- `POST /api/ai/chat` `{ "message": "..." }`
- `POST /api/ai/summary`
- `POST /api/ai/automation-draft` `{ "request": "..." }`
- `POST /api/ai/action-draft` `{ "request": "..." }`
- `POST /api/ai/action-execute` `{ "confirm": true, "plan": { ... } }`

Az Akciók tabon külön **Esti AI összefoglaló** sablon is van. Ez `schedule` triggerrel `ai.summary` actiont futtat, az eredményt eltárolja a HomeHub értesítései között, és opcionálisan emailben is elküldi.

Az automatizálási draft a Responses API Structured Outputs (`json_schema`) formátumát használja, majd a szerver a HomeHub saját `automationRuleInputSchema` sémájával is újra validálja.

## Biztonsági policy

AI-ból minden esetben blokkolt:

- gate/myGate Tuya parancsok, beleértve nyitás, zárás, start, pedestrian, stop és light műveleteket;
- `learn`, `erase`, `factory`, `reset`, pairing vagy credential jellegű DP-k;
- feyree EV töltő áramlimit és nagyáramú preset DP-k.

A gate állapota triggerként továbbra is használható, például tartósan nyitva maradt kapu riasztásához.

## Kontextus

Az AI csak a HomeHub által aktuálisan ismert állapotot kapja meg:

- Tuya eszköznév, online állapot, status DP-k;
- tervezéskor a Tuya functions listája és DP metadata;
- hálózati eszközök ID / név / IP / MAC / online állapot;
- Xiaomi porszívó alapállapot;
- meglévő automatizálások és az utolsó riasztások.

Jelszó, Tuya Secret, Bridge token, Xiaomi token vagy OpenAI API-kulcs nem kerül AI kontextusba.

## Render

```text
OPENAI_API_KEY=<saját OpenAI API key>
OPENAI_MODEL=gpt-5
AI_TIMEOUT_MS=45000
```

Az `OPENAI_MODEL` konfigurálható, így később modellváltáshoz nem kell új release.
