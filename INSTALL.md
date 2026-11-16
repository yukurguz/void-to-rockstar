# Установка

Нужны Windows, Ableton Live 12 и клавиатура M-Vave SMK-37. Для тренажёра нужен Live Suite или Max for Live.

Папка User Library у каждого своя. Узнать её можно в Ableton: **Settings → Library → Location of User Library**.

## 1. Подключение по Bluetooth

Сделайте всё по инструкции [SMK-37-Bluetooth-MIDI.md](SMK-37-Bluetooth-MIDI.md). В результате в системе появится MIDI-порт `SMK-37 BT`. Если клавиатура подключена кабелем USB, этот шаг не нужен, а вместо `SMK-37 BT` дальше выбирайте её собственный порт.

## 2. Скрипт клавиатуры

1. Скопируйте папку `SMK37` из `SMK37 Remote Script` в `User Library\Remote Scripts\`. Если папки `Remote Scripts` нет, создайте её.
2. Перезапустите Ableton.
3. Откройте **Settings → Link, Tempo & MIDI**.
4. В первой строке выберите: **Control Surface** → `SMK37`, **Input** → `SMK-37 BT`, **Output** → `None`.
5. В списке портов у входа `SMK-37 BT` включите **Track** и **Remote**, выключите Sync и MPE.
6. У выхода `SMK-37 BT` выключите все галочки. Иначе сигнал пойдёт по кругу и loopMIDI заглушит порт.

## 3. Дорожки

- На дорожке клавиш: **MIDI From** → `SMK-37 BT`, канал `Ch. 4`.
- На дорожке барабанов с Drum Rack: **MIDI From** → `SMK-37 BT`, канал `Ch. 9`.
- Чтобы обе звучали сразу, поставьте на обеих **Monitor** → `In`.

## 4. Тренажёр

1. Скопируйте оба файла из папки `SMK Trainer` (`SMK Trainer.amxd` и `smk_trainer.js`) в `User Library\Presets\MIDI Effects\Max MIDI Effect\`. Файлы должны лежать рядом.
2. В браузере Ableton откройте **User Library → Presets → MIDI Effects → Max MIDI Effect**.
3. Перетащите **SMK Trainer** на дорожку клавиш.
4. Начните с урока «С чего начать»: он объясняет, что где на экране.

Для барабанных уроков перетащите тренажёр ещё и на дорожку барабанов. Очки у обоих общие.

Очки хранятся в файле `smk_trainer_progress.json` рядом с устройством. Чтобы начать с нуля, удалите этот файл.

## Если что-то не так

| Что происходит | Что проверить |
|---|---|
| `SMK37` нет в списке Control Surface | Папка лежит в `User Library\Remote Scripts\SMK37`, Ableton перезапущен |
| Энкодеры крутят в обратную сторону | В `SMK37.py` поменяйте `ENCODER_LOW_VALUE_INCREASES` |
| Пэды или фейдеры не реагируют | У вашей клавиатуры другие номера: поправьте константы в начале `SMK37.py` |
| Тренажёр показывает пустое окно | `smk_trainer.js` не лежит рядом с `SMK Trainer.amxd` |
| Тренажёр не видит клавиши | На дорожке стоит не тот канал, должен быть `Ch. 4` |
| Не меняется звук от колеса Mod | В самом инструменте колесо не назначено ни на один параметр |
