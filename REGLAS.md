# BATTLECHIS — Reglas del juego

*Juego de estrategia táctica que combina **Risk** (combate y conquista) y **Parchís** (movimiento por dado). Estas son las reglas de la versión actual, redactadas como si jugaras en un tablero real.*

---

## 🎯 Objetivo

Ser el último comandante en pie o dominar el sector. Ganas la partida si logras **cualquiera** de estas tres cosas (ver [Condiciones de victoria](#-condiciones-de-victoria)):

1. Eliminar a todos los rivales.
2. Controlar el **60 %** de las bases estratégicas.
3. Mantener el **NÚCLEO** durante 3 turnos tuyos.

---

## 🧩 Componentes

- **Jugadores:** de 2 a 5 comandantes (cada puesto puede ser humano o IA).
- **5 facciones**, cada una con su color:
  | Facción | Color |
  |---|---|
  | ALPHA (Crimson) | 🔴 Rojo |
  | DELTA (Blue Eagle) | 🔵 Azul |
  | SIGMA (Lightning) | 🟡 Amarillo |
  | GAMMA (Viper) | 🟢 Verde |
  | OMEGA (Eclipse) | 🟣 Morado |
- **El tablero** tiene forma de estrella/pentagrama con tres tipos de posiciones:
  - **5 Cuarteles Generales (HQ)** — la base de cada facción, en el anillo exterior.
  - **5 Bases neutrales** — bases intermedias, entre el exterior y el centro.
  - **1 NÚCLEO** (Centro de Control Estratégico) — la posición central.
  - **Casillas de camino** que conectan todo, y **5 Casillas Sorpresa** (una en mitad de cada tramo del anillo exterior).
- **1 dado** de 6 caras.

### Distancias del tablero (en pasos/casillas)

| Trayecto | Pasos |
|---|---|
| De un HQ al HQ vecino | **8** |
| De un HQ a una base neutral | **7** |
| De una base neutral al NÚCLEO | **3** |
| De un HQ al NÚCLEO (mínimo) | **10** |

> Las distancias entre bases grandes son deliberadamente largas: **no puedes llegar de un HQ a otro (ni a una base intermedia) con una sola tirada de dado.**

---

## 🚀 Preparación

1. Cada jugador elige una facción y ocupa su **HQ** con **5 tropas** de inicio.
2. Las bases neutrales y el NÚCLEO empiezan **vacíos**.
3. Empieza el primer jugador. Se juega por turnos en orden.

---

## 🔄 Estructura de un turno

Cada turno tiene estas fases, en orden:

### 1️⃣ Refuerzos (reclutamiento)

Recibes **3 tropas por cada base que controles** (HQ + bases neutrales + NÚCLEO), con un **mínimo de 1**.

> Ejemplo: si controlas tu HQ + 2 bases neutrales = 3 bases → **9 tropas** de refuerzo.

Puedes **repartir** esas tropas entre tus distintas bases como quieras (todas en una, o unas cuantas en cada una). Solo se pueden desplegar refuerzos en **bases** (HQ, neutrales, NÚCLEO), no en casillas de camino.

#### 🛡️ Fortificación: comprar escudos (fase propia, tras reforzar)

Tras repartir todos los refuerzos y **antes de lanzar el dado**, aparece la **fase de fortificación**, donde puedes canjear tropas por **escudos**:

- **Requisito:** debes controlar **al menos 10 tropas** en total en el tablero.
- **Coste:** **5 soldados por 1 escudo, tomados de la propia base que fortificas** (esa base debe tener al menos **6 tropas**, para que le quede 1 de guarnición).
- **Límites:** máximo **1 escudo por turno**, solo en **bases propias** (HQ, neutrales o NÚCLEO), y cada base almacena como máximo **3 escudos**.
- Puedes elegir una base de la lista o **continuar sin fortificar**.

Los escudos se quedan en la base y la protegen de los ataques (ver [Asalto a una base fortificada](#-asalto-a-una-base-fortificada)). Si el enemigo captura la base, sus escudos se pierden.

### 2️⃣ Movimiento

- **Tira el dado.** Debes mover un pelotón **exactamente** tantas casillas como indique el dado, avanzando por casillas conectadas (sin pasar dos veces por la misma casilla en el mismo recorrido).
- Elige **cuántas tropas** mueves de la posición de origen.
- **Regla de guarnición:** de una **base** (HQ, neutral, NÚCLEO) debes dejar **al menos 1 tropa**. De una casilla de camino puedes mover todas.
- **Regla del 6:** si sacas un **6**, vuelves a tirar y mueves otra vez (hasta **2 veces seguidas** adicionales).

Según a dónde llegue tu pelotón:

| Destino | Qué pasa |
|---|---|
| Casilla de camino **vacía** | La ocupas directamente. |
| Casilla **propia** | Refuerzas esa posición (se suman las tropas). |
| Base neutral o NÚCLEO **vacío** | **Tirada de conquista** (ver abajo). |
| Casilla **enemiga** (camino o base) | **Combate** (ver abajo). |
| **Casilla Sorpresa** | Robas una carta sorpresa (ver abajo). |

> Una casilla de camino o sorpresa que se queda con **0 tropas** vuelve a ser libre (neutral).

#### 🚧 Bloqueo al cruzar una casilla enemiga

Si en tu ruta hacia el destino **cruzas una casilla de camino ocupada por otro jugador** (no aliado), tu pelotón se **detiene** en esa casilla y ese jugador decide:

- **Dejar pasar** 🕊️ — tu pelotón continúa hasta su destino sin desgaste.
- **Bloquear** ⚔️ — se interpone y comienza un **combate** en esa casilla. Si el atacante **gana**, abre paso y **sus tropas supervivientes continúan hasta el destino original**; si pierde, se retira a su casilla de origen.

En **online**, el defensor tiene **15 segundos** para responder; si no responde, se **bloquea** automáticamente. En **local** decide sin límite de tiempo. Si la casilla la ocupa un bot, la IA decide con criterio (bloquea si tiene tropas suficientes).

### 3️⃣ Redistribución (solo jugadores humanos)

Al terminar de mover, antes de pasar el turno, puedes **reorganizar tus tropas** libremente: mover tropas entre posiciones propias conectadas entre sí (a través de tu territorio y caminos libres), **las veces que quieras**. Cuando acabes, pulsa **Fin de turno**.

---

## ⚔️ Combate (atacar una casilla enemiga)

El combate se resuelve por **rondas**. En cada ronda, atacante y defensor tiran **1 dado** cada uno:

- **Gana el número más alto.** El perdedor pierde **1 tropa**.
- **Empate → gana el defensor** (el atacante pierde 1 tropa).

Se repiten rondas hasta que un bando se queda **sin tropas**:

- Si el **defensor** llega a 0 → el **atacante conquista** la casilla y la ocupa con las tropas supervivientes.
- Si el **atacante** llega a 0 → el defensor resiste.
- El atacante puede **retirarse** en cualquier momento: sus tropas supervivientes vuelven a la casilla de origen.

---

## 🎲 Conquista de bases vacías (base neutral o NÚCLEO)

Cuando tu pelotón llega a una **base neutral vacía** o al **NÚCLEO vacío**, haces **una tirada de asalto**:

| Dado | Resultado |
|---|---|
| **1** | ❌ Falla el asalto: tus tropas **retroceden** a su casilla de origen. |
| **2, 3, 4, 5 o 6** | ✅ **Conquistas** la base. |

---

## 🛡️ Asalto a una base fortificada

Si atacas una **base enemiga que tiene escudos**, el combate se resuelve en **dos fases**:

**FASE 1 — Asedio (derribar escudos):** haces **una única tirada** de dado contra las defensas:

| Dado | Escudos destruidos |
|---|---|
| **1** | −1 escudo |
| **2 o 3** | −2 escudos |
| **4, 5 o 6** | −3 escudos (todos) |

- Si **queda algún escudo en pie**, el asalto es **repelido**: tus tropas **vuelven a su casilla de origen** y ese pelotón no entra.
- Si caen **todos los escudos** (o la base no tenía), se abre la **brecha** → pasas a la Fase 2.

**FASE 2 — Cuerpo a cuerpo:** se inicia el **combate estándar** de BattleChis (rondas de dados, el mayor gana, empate favorece al defensor).

---

## 🎁 Bono de captura

Al tomar una posición (por conquista o ganando un combate) recibes tropas de refuerzo gratis según el tipo:

| Posición capturada | Bono |
|---|---|
| **Cuartel General (HQ)** | **+10 tropas** |
| **Base neutral** | **+5 tropas** |
| Camino / NÚCLEO | +0 |

---

## 🃏 Casillas Sorpresa

Hay **5 casillas sorpresa** repartidas por el anillo exterior. Cuando tu pelotón **cae** en una, roba **una carta** que se aplica al instante a ese pelotón:

- Cartas posibles: **+5, +3, +2, +1, −1, −2, −3** tropas.
- Si una carta negativa deja al pelotón en **0 o menos**, el pelotón es **aniquilado** y la casilla queda libre.

---

## 👑 El NÚCLEO (Centro de Control Estratégico)

El NÚCLEO es la posición más valiosa y está protegido:

- **Para poder atacar el NÚCLEO** debes controlar **al menos 3 bases satélite** (HQ o bases neutrales). Con menos de 3, no puedes entrar.
- **Victoria por NÚCLEO:** si controlas el NÚCLEO durante **3 turnos tuyos** (tres de tus propios turnos, no cuentan los turnos de los demás), **ganas la partida**.
- Si pierdes el NÚCLEO (o dejas de tener 3 bases), el contador se reinicia.

---

## 🤝 Diplomacia (alianzas)

- Puedes **proponer una alianza** (pacto de no agresión) con otro comandante.
- Mientras dure la alianza, **no puedes atacar** a tu aliado ni él a ti.
- Puedes **romper la alianza** en cualquier momento (¡traición!) para volver a atacarle.

---

## 🏆 Condiciones de victoria

La partida termina en cuanto un comandante cumple **cualquiera** de estas:

1. **Último en pie** — todos los demás comandantes han sido eliminados (un comandante queda eliminado cuando se queda sin ninguna tropa en el tablero).
2. **Dominación total** — controlas el **60 %** de todas las bases estratégicas (HQ + bases neutrales + NÚCLEO).
3. **Control del NÚCLEO** — mantienes el NÚCLEO durante **3 turnos tuyos**.

---

## 📋 Resumen rápido

| Concepto | Valor |
|---|---|
| Tropas iniciales en tu HQ | 5 |
| Refuerzos por turno | 3 × nº de bases (mín. 1) |
| Distancia HQ ↔ HQ | 8 pasos |
| Distancia HQ ↔ base neutral | 7 pasos |
| Distancia base neutral ↔ NÚCLEO | 3 pasos |
| Movimiento | Exactamente lo que marca el dado |
| Regla del 6 | Vuelves a tirar (hasta 2 veces más) |
| Guarnición mínima en bases | 1 tropa |
| Conquista base vacía | 1 = falla · 2-6 = conquista |
| Combate | Dado más alto gana; empate = defensor |
| Bono de captura | HQ +10 · neutral +5 |
| Cartas sorpresa | +5, +3, +2, +1, −1, −2, −3 |
| Fortificar (fase tras reforzar) | 5 tropas de la base → 1 escudo (≥10 tropas totales, base con ≥6; máx. 1/turno, 3/base) |
| Asedio (base con escudos) | dado 1→−1 · 2-3→−2 · 4-6→−3; si queda alguno, repelido |
| Bloqueo al cruzar | el ocupante deja pasar o bloquea (combate); online 15 s → bloquear |
| Requisito para atacar el NÚCLEO | 3 bases satélite |
| Victoria por NÚCLEO | 3 turnos propios |
| Victoria por dominación | 60 % de las bases |

---

*BattleChis · versión digital jugable en https://battlechis.vercel.app*
