# Modello dati del pavé

## Dataset corrente

`data/milan-pave-central.json` è un estratto locale di geometrie OpenStreetMap usato come
base resiliente quando Overpass non risponde.

Baseline del 30 luglio 2026:

- 1.530 way con ID univoco;
- 6.948 coordinate;
- nessuna geometria con meno di due punti;
- 942 `sett`;
- 521 `paving_stones`;
- 52 `cobblestone`;
- 15 `unhewn_cobblestone`.

Ogni record contiene attualmente `id`, `name`, `surface` e `coordinates`. L’ID è quello della
way OSM; il nome può mancare all’origine ed essere normalizzato come strada senza nome.

## Classificazione proposta

| Stato | Significato | Uso nel routing |
| --- | --- | --- |
| `confirmed_pave` | OSM dichiara `sett`, `cobblestone` o `unhewn_cobblestone` | penalità piena |
| `probable_pave` | OSM dichiara `paving_stones`, materiale eterogeneo | penalità pesata |
| `confirmed_not_pave` | fonte verificata dichiara fondo non pavé | nessuna penalità |
| `unknown` | dato assente o non interpretabile | nessuna penalità, copertura ridotta |

`unknown` non deve mai essere trasformato automaticamente in pavé.

## Confidenza

La confidenza è separata dalla classe:

- `high`: geometria valida e classificazione esplicita verificata;
- `medium`: classificazione OSM esplicita ma potenzialmente eterogenea;
- `low`: dato comunitario non ancora verificato o stima;
- `unknown`: nessuna evidenza disponibile.

Il dataset locale corrente non contiene data di estrazione, versione dello schema o data di
verifica per singola way. Fino a una rigenerazione tracciabile, `sett`, `cobblestone` e
`unhewn_cobblestone` sono trattati come confidenza media; `paving_stones` come probabile a
confidenza media. Non vengono inventate date di aggiornamento.

## Validazione richiesta

- coordinate finite e nell’area supportata;
- almeno due punti distinti per geometria;
- ID univoco;
- superficie inclusa nell’elenco normalizzato;
- segmenti di lunghezza non nulla e salti geografici sospetti segnalati;
- duplicati geometrici separati dai duplicati di ID;
- versione dello schema e provenienza presenti alla prossima generazione del dataset.

## Metriche restituite dal routing

Per ogni candidato sono necessarie:

- distanza e durata;
- metri e percentuale di pavé;
- deviazione rispetto al più rapido;
- copertura nota della superficie;
- confidenza aggregata;
- provider e profilo.

Le percentuali devono essere calcolate sulla distanza della geometria e indicate come stime:
la qualità dipende dalla corrispondenza tra geometria del router e geometria OSM.

## Aggiornamenti live e contributi

Overpass può aggiornare in memoria le way per ID durante la pianificazione. Non modifica il
file locale. Le segnalazioni della comunità restano separate e non cambiano automaticamente
la classificazione finché non sono verificate. Una futura pipeline di rigenerazione dovrà
salvare query, timestamp, conteggi, validazione e hash del dataset.

