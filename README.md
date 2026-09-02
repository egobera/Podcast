# Estudio

Production workspace for serialized audio fiction. The script is the interface: paste it, see
everything the episode needs, fill each gap, hear the whole thing.

---

# Instalación paso a paso

Tiempo estimado: 45 minutos la primera vez. Necesitas cuentas en Supabase, GitHub, Netlify y Monid.

---

## Paso 1. Instalar las herramientas base

Necesitas **Node.js 20 o superior** y **Git**. Comprueba en la terminal:

```bash
node -v
git --version
```

Si `node -v` da error o un número menor que 20, instala Node desde nodejs.org, versión LTS.

---

## Paso 2. Poner el código en tu computadora

Descomprime la carpeta `estudio` donde guardes tus proyectos. Después, en la terminal:

```bash
cd ruta/hasta/estudio
npm install
```

Tarda un par de minutos.

---

## Paso 3. Crear el proyecto en Supabase

1. Entra en supabase.com y crea una cuenta
2. **New project**. Ponle nombre, elige una contraseña de base de datos y guárdala
3. Región: la más cercana a ti
4. Espera dos minutos a que termine de crearse

Cuando esté listo:

5. Menú lateral, **SQL Editor**, **New query**
6. Abre el archivo `supabase/schema.sql` de este proyecto, copia **todo** su contenido y pégalo
7. Pulsa **Run**. Debe decir "Success"
8. Nueva consulta, y repite con `supabase/migration-002-template-and-blocks.sql`
9. Nueva consulta otra vez, y repite con `supabase/migration-003-teams.sql`
10. Y una última con `supabase/migration-004-language.sql`

El primero crea las tablas, las reglas de seguridad y el almacén de audio. El segundo añade la
plantilla de episodio, el bloque de congelamiento y los objetivos de duración de 8 minutos. El
tercero convierte todo en multiusuario.

> Si ya tenías la app instalada, ejecuta solo las migraciones que te falten, en orden. Ninguna borra
> nada. La 003 mueve tus series existentes a un equipo personal y deja los archivos donde están.

### Recoger las claves

9. Menú lateral, **Project Settings**, **API**
10. Copia estos tres valores, los vas a necesitar:
   - **Project URL**
   - **anon public** key
   - **service_role** key (esta es secreta, nunca la pongas en el navegador)

### Activar el acceso con contraseña

11. **Authentication**, **Providers**, **Email**: comprueba que está activado
12. En ese mismo panel, **desactiva "Confirm email"**

    Con esto entras con correo y contraseña sin que Supabase mande ningún correo. Si lo dejas
    activado, se envía un correo de confirmación al crear la cuenta y hay que abrirlo una vez.
    El plan gratuito limita los envíos a unos pocos por hora, así que desactivarlo evita quedarte
    fuera si creas y borras cuentas mientras pruebas.

13. En **Authentication**, **URL Configuration**, añade `http://localhost:5173` a las URLs
    permitidas. Hace falta solo para el enlace de recuperación de contraseña.

---

## Paso 4. Crear la cuenta de Monid

1. Entra en monid.ai y crea una cuenta
2. Añade saldo. Con 20 dólares tienes de sobra para probar
3. Genera una API key y cópiala

---

## Paso 5. Clave de ElevenLabs

La clonación de voz no pasa por Monid, así que necesitas una clave directa.

1. Entra en elevenlabs.io con tu cuenta
2. Perfil, **API Keys**, crea una y cópiala

Si de momento no vas a clonar voces, puedes dejar este valor vacío y rellenarlo después.

---

## Paso 6. Configurar las variables locales

En la carpeta del proyecto, copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Abre `.env` y rellena los seis valores con lo que copiaste. Las que empiezan por `VITE_` van al
navegador y son públicas; las otras cuatro son secretas y solo las ve el servidor.

**El archivo `.env` nunca se sube a GitHub.** Ya está excluido en `.gitignore`.

---

## Paso 7. Probar en tu computadora

```bash
npm run dev
```

Abre `http://localhost:5173`. Deberías ver la pantalla de acceso. Escribe tu email, te llega un
enlace, y entras.

En local, las funciones de servidor todavía no responden. Para probarlas también:

```bash
npm install -g netlify-cli
netlify dev
```

Eso levanta la web y las funciones a la vez, en el puerto 8888.

---

## Paso 8. Subir a GitHub

```bash
git init
git add .
git commit -m "Primera versión"
```

Después, en github.com, crea un repositorio nuevo **privado**, sin README. Copia los dos comandos
que te muestra y ejecútalos. Serán parecidos a:

```bash
git remote add origin https://github.com/tuusuario/estudio.git
git branch -M main
git push -u origin main
```

---

## Paso 9. Desplegar en Netlify

1. Entra en netlify.com y accede con tu cuenta de GitHub
2. **Add new site**, **Import an existing project**, **GitHub**
3. Elige el repositorio `estudio`
4. La configuración de build ya viene en `netlify.toml`, no toques nada
5. **Deploy**

### Meter las variables

6. Site configuration, **Environment variables**, **Add a variable**, **Import from a .env file**
7. Pega el contenido de tu `.env`
8. **Deploys**, **Trigger deploy**, **Clear cache and deploy site**

### Activar el plan de pago

El botón de "Generate first pass" usa **Background Functions**, que corren hasta 15 minutos y
requieren plan de pago en Netlify. Sin él, la generación de un solo elemento funciona pero la
generación masiva se corta a los 10 segundos.

### Volver a Supabase

9. Copia la URL que te dio Netlify
10. En Supabase, **Authentication**, **URL Configuration**, añádela a las URLs permitidas

---

## Paso 10. Primer uso

1. **Create an account** con tu correo y una contraseña de al menos 8 caracteres. La sesión queda
   guardada en el navegador y se renueva sola, así que no vuelves a escribirla salvo que cierres
   sesión o cambies de dispositivo
2. Crea la serie. Puedes tener varias, cada una con su propia bóveda, sus voces y sus episodios.
   La pantalla de la bóveda te muestra una lista de primeros pasos hasta que la completas
3. **Vault**: sube la sintonía de apertura, la de cierre, las camas y los tres archivos del
   congelamiento. Esto se hace una sola vez para toda la serie
4. **New episode**: crea el primero. Nace con la apertura y el cierre ya colocados, porque están
   marcados para colocación automática en el vault
5. Pega el guion y pulsa **Read script**. La app extrae los personajes, las líneas y los efectos
6. **Characters**: asigna una voz a cada personaje. Para la voz del niño, sube 1 a 3 minutos de
   audio limpio y usa **Clone from audio**
7. Vuelve al episodio y pulsa **Generate first pass**

---

## Idioma y acento

Son dos cosas distintas y conviene no confundirlas.

**El idioma** se manda al modelo en cada generación como código ISO 639-1, y determina cómo lee
números, horas y abreviaturas. Sin fijarlo, el modelo lo adivina del texto y a veces se equivoca.

**El acento no es un parámetro que el modelo acepte.** Sale de la voz. Si clonas a alguien con
acento mexicano, todas sus líneas sonarán mexicanas, aunque el guion esté escrito en otro español.
Si clonas a alguien de Madrid, seguirá sonando a Madrid por mucho que el texto diga *tenis* y
*aventar*.

Por eso no existe un código `es-MX`: el modelo solo conoce `es`. La variedad regional sale de dos
sitios que sí controlas, el acento de la voz y el vocabulario del guion.

En Estudio, el idioma y el acento de la serie se fijan en la bóveda. Cada personaje puede tener su
propio acento si el papel lo pide, y la app avisa cuando difiere del de la serie.

**Consecuencia práctica:** graba la muestra de clonación en el mismo idioma y acento en que vas a
publicar. Es una decisión que se arrastra durante todas las temporadas.

## Equipos

Todo pertenece a un equipo, no a una persona. Los miembros de un equipo ven las mismas series, la
misma bóveda y las mismas voces. Nada se duplica.

**Invitar a alguien** es escribir su correo en la pestaña Team y elegir un rol. **Estudio no envía
ningún correo**: la invitación queda guardada y se convierte en acceso real en cuanto esa persona
crea su cuenta o entra con esa dirección. Avísale tú por el canal que uses normalmente.

| Rol | Puede |
|---|---|
| Owner | Gestionar personas y todo lo demás |
| Editor | Crear y modificar cualquier cosa |
| Viewer | Escuchar y leer, sin modificar |

Los roles se aplican en la base de datos, no en la interfaz, así que un viewer no puede escribir ni
aunque manipule la aplicación desde el navegador.

**Sobre el audio ya subido:** los archivos anteriores viven bajo la carpeta de quien los subió, y la
migración no los mueve. En su lugar, la regla de acceso permite leerlos a cualquiera que comparta
equipo con esa persona. Nada se rompe y nada hay que volver a subir.

## La biblioteca

Al entrar aterrizas en **All series**, no dentro de un proyecto. Cada serie es una tarjeta con sus
episodios representados por una **espina de estado**: una barra por episodio, segmentada según el
estado real de sus elementos. Verde lo aprobado, gris lo que espera revisión, ocre lo que falta.

No es decoración. De un vistazo ves que el episodio tres está terminado y el cinco sin empezar, sin
abrir nada.

Arriba, **Pick up where you left off** muestra los tres episodios más avanzados sin terminar,
ordenados por cuánto les queda. Es el atajo que evita navegar por la barra lateral cada vez.

## Escuchar el episodio

Pulsa **espacio** en cualquier momento, o el botón de reproducción de la barra inferior. La app
descarga todo lo aprobado, lo coloca en su minuto y lo reproduce como lo va a oír el oyente.

Los niveles no se ajustan a mano. Salen del papel de cada elemento: voz, ambiente, efecto puntual,
impacto, cama musical o sintonía. Y las camas y ambientes **bajan solos** cuando alguien habla, con
una rampa de 0,18 segundos, y vuelven a subir en los silencios. Eso es la diferencia más grande
entre una mezcla que suena amateur y una que suena producida.

La barra inferior es navegable: haz clic en cualquier punto para saltar ahí.

## Exportar

El botón **Export** abre un control de calidad antes de sacar nada. Avisa de elementos sin aprobar,
de duración fuera del objetivo, de líneas solapadas y de camas musicales mal ancladas. Los avisos
graves se marcan aparte, pero nunca te bloquean: puedes exportar igual.

Lo que produce:

| Archivo | Para qué |
|---|---|
| Mezcla WAV | El episodio completo, normalizado al objetivo del proyecto |
| Tres stems | Voz, música y efectos por separado |
| Proyecto `.rpp` | Se abre en Reaper con cada clip en su pista y en su minuto |
| Hoja de cues | Texto plano con tiempos, carril, nivel y archivo, por si no usas Reaper |

El renderizado ocurre en la pestaña con OfflineAudioContext, más rápido que en tiempo real y con
precisión de sample. La mezcla que sale es exactamente la que oíste en el reproductor.

La normalización mide la sonoridad integrada y aplica una ganancia para llegar al objetivo, con
techo duro sin compresión. Este material vive del rango dinámico.

## El panel inferior

Es la vista de conjunto, y funciona como la de cualquier estación de audio.

**Regla de tiempo** con marcas que se adaptan a la duración del episodio, y **formas de onda reales**
dibujadas a partir del audio decodificado. Los clips que todavía no tienen audio aprobado aparecen
translúcidos, así que de un vistazo ves dónde están los huecos.

**Arrastra en cualquier parte de los carriles** para navegar. Al soltar sobre un clip, la línea
correspondiente del guion se selecciona y se centra en pantalla. Funciona en las dos direcciones:
lo que eliges arriba se resalta abajo.

**M y S en cada carril.** Silencio y solo, como en una mesa de mezclas. Solo la voz es la forma
rápida de comprobar si se entiende todo; silenciar la música te dice si un efecto está tapado.

**Monitorización.** El interruptor *Phone speaker* filtra la mezcla para imitar el altavoz de un
teléfono: corta por debajo de 420 Hz y por encima de 4,2 kHz, y realza la presencia. Es el
escenario real en el que se va a escuchar la mayor parte de este contenido, y una mezcla que solo
funciona con buenos auriculares es una mezcla sin comprobar.

| Tecla | Acción |
|---|---|
| `espacio` | Reproducir o pausar |
| `shift` + `←` `→` | Saltar al elemento anterior o siguiente |

## El panel derecho

El detalle de cada elemento vive en una columna fija a la derecha, no dentro de la lista. Recorres
las líneas con las flechas y el panel cambia sin que el guion se mueva ni pierdas el sitio.

Cuando no hay nada seleccionado, ese espacio muestra el estado del episodio: duración frente al
objetivo, cuánto está aprobado, de qué está hecho el episodio (líneas, sonido, música) y los avisos
del control de calidad en vivo, sin esperar a exportar.

Por debajo de 1180 píxeles de ancho el panel pasa a colocarse bajo el guion.

## Revisar con el teclado

Aprobar 160 elementos con el ratón no es un flujo de trabajo. Los atajos aparecen al final de cada
episodio:

| Tecla | Acción |
|---|---|
| `espacio` | Reproducir o pausar el episodio |
| `↑` `↓` | Moverse entre líneas |
| `enter` | Abrir la línea |
| `a` | Aprobar la toma más reciente |
| `g` | Pedir otra toma |
| `n` | Saltar al siguiente hueco |

**Aprobar avanza solo.** Cuando pulsas `a`, la app aprueba y salta al siguiente elemento que
todavía necesita atención, saltándose lo que ya está listo. Con el filtro en **Review** puedes
recorrer un episodio entero sin tocar el ratón.

Arriba hay un filtro segmentado con el recuento de cada estado: todo, lo que falta, lo que espera
revisión y lo aprobado.

## Cómo funcionan la plantilla y el congelamiento

**La plantilla de episodio.** Los assets del vault marcados como apertura o cierre se colocan solos
en cada episodio nuevo, ya aprobados, porque el audio existe. Un episodio nunca nace vacío.

**El bloque de congelamiento.** Selecciona la línea del monólogo dentro del tiempo detenido y pulsa
**Wrap in a freeze**. Se crea la entrada antes, el regreso después, y diez pulsos que se reparten a
lo largo de esa línea. Los pulsos no tienen posición fija: se recalculan cada vez que la línea
cambia de duración, así que el reparto sigue el ritmo del actor y no un reloj. El décimo siempre cae
justo antes del regreso.

Necesita los tres archivos maestros en el vault. Hasta entonces el botón está desactivado y la app
te dice por qué.

**Volver a leer el guion no destruye nada.** Reemplaza solo lo que vino del guion. Las sintonías de
plantilla y los bloques insertados se quedan intactos, y las tomas aprobadas cuya línea no cambió
conservan su audio. La app te dice cuántas se conservaron y cuántas necesitan toma nueva.

---

## Lo que la app no hace, a propósito

Aparece explicado dentro de la propia interfaz, en el sitio donde hace falta, con los pasos para
hacerlo a mano:

- **Reverb invertida.** Se fabrica en Audacity en dos minutos. Las instrucciones están en el Vault
- **Montaje del congelamiento.** Tres archivos maestros que se construyen una vez
- **Corte de silencio dentro de la sintonía.** Se hace en cualquier editor
- **Edición fina en milisegundos.** Se exporta a un DAW y se trabaja ahí
- **Masterización.** La app normaliza al objetivo del proyecto y nada más

Estudio coloca y organiza. No talla. Esa frontera es una decisión, no una carencia.

---

## Instalarla como aplicación

La app trae manifiesto e iconos, así que se puede sacar del navegador y tenerla como una ventana
propia, sin barra de direcciones ni pestañas.

**En Mac con Chrome o Edge:** abre la app, menú de los tres puntos, **Guardar y compartir**,
**Instalar página como aplicación**. Aparece en el Launchpad y puedes anclarla al Dock.

**En Mac con Safari:** menú **Archivo**, **Añadir al Dock**.

**En Windows con Chrome o Edge:** el icono de instalar aparece a la derecha de la barra de
direcciones.

**En iPhone o iPad:** compartir, **Añadir a pantalla de inicio**.

El icono es una onda de audio que se detiene: diez barras que suben y bajan, y donde debería estar
la última hay un hueco. Solo son barras verticales, así que se sigue leyendo a 16 píxeles en el Dock.

## Problemas frecuentes

**"Missing VITE_SUPABASE_URL"**
El archivo `.env` no existe o no tiene los valores. Recuerda reiniciar `npm run dev` después de
editarlo.

**No puedo crear una serie y no pasa nada al pulsar**
Casi siempre es que falta ejecutar `migration-003-teams.sql`. Sin ella no existe el equipo al que
pertenece la serie. La app ahora te lo dice en pantalla en vez de fallar en silencio.

**"That email and password do not match an account"**
Si acabas de registrarte y "Confirm email" sigue activado en Supabase, la cuenta existe pero está
sin confirmar. O desactivas esa opción, o abres el correo de confirmación una vez.

**El correo de recuperación no llega**
Revisa spam, y comprueba que la URL desde la que entras está en Supabase, Authentication, URL
Configuration. El plan gratuito limita los envíos por hora.

**"Not signed in" al generar**
La sesión caducó. Recarga la página.

**La generación masiva se corta**
Background Functions requiere plan de pago en Netlify.

**"This character has no voice set yet"**
Ve a Characters y asigna un voice_id, o clónalo desde audio.
