# HomeHub automatizálási audit és email

A v0.21 minden sikeres vagy részben sikeres automatizálási lefutásról `automation` kategóriájú Timeline eseményt ír.

A rekord tartalmazza:

- `reason`: a trigger tényleges oka;
- `actions`: sikeresen végrehajtott akciók;
- `failures`: hibás akciók;
- `result`: összesített eredmény.

Példa:

```text
Nappali túl meleg: lefutott. Ok: Air Conditioner: temp_current = 28.1; feltétel: > 27 · legalább 300 másodpercig fennállt. Akció: Air Conditioner: switch → true. Eredmény: 1 akció sikeresen végrehajtva.
```

A `notifyEmail` új szabálymező. Ha true, és a szabályban nincs külön emailt küldő alert/AI-summary action, a HomeHub automatikusan emailt küld ugyanerről az ok/akció/eredmény tartalomról. Így nincs dupla email, de az alap automatizálások is értesítenek.
