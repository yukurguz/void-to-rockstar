# Translating the trainer into English

SMK Trainer is a music trainer that lives inside Ableton Live (a Max for Live device). It teaches a beginner to play a MIDI keyboard: lessons that show which key to press, lessons about synths, effects and Ableton itself, and a free-play mode with advice. Its screen is tiny (986 x 169 pixels) and its text is drawn with a 5 x 7 pixel font, ALL IN CAPITALS. The interface and all texts are in Russian. You translate one part of them into English.

The Russian source is `trainer/smk_trainer.js` (read only: do not edit it). Your part is a list of string literals taken from it, in the order they appear there, so neighbouring items belong to the same lesson or table. When an item is unclear on its own, search for it in the source to see how it is used.

## Files

- Input: `trainer/lang/ru_<N>.txt`. One item a line: four digits, a TAB, the Russian text.
- Output: `trainer/lang/en_<N>.txt`. The same lines in the same order: the same four digits, a TAB, the English text. UTF-8, no blank lines, nothing else in the file. Every item of the input must be there.
- Check: `node trainer/lang/check.js <N>`. Run it and fix what it reports until it prints `OK`. Do not change `check.js` or the input.

Work through the part in order, in pieces of about a hundred items: write, check, go on. Do not write a script that translates: translate yourself, item by item.

## Hard rules (the check enforces most of them)

1. **Characters.** Only `A-Z a-z 0-9` and `. , : ! ? - + / % ( ) < > #` and the space. No apostrophes, no quotes, no semicolons, no ampersands, no dashes other than the plain hyphen, no accented letters. So write "do not", "it is", "the chord of C", never "don't", "it's", "C's".
2. **Length.** The screen has no room to spare. The English must not be longer than the Russian by more than about 8% (short labels of up to 14 characters: at most one character longer). Shorter is always fine. If a faithful translation does not fit, say it more briefly: drop filler, use the shorter word. Never drop a fact, a number or an instruction.
3. **Spaces.** Many items are pieces that the program glues to a number or a name: `"Шаг "`, `" из "`, `" очков"`. Keep the spaces at the start and at the end exactly as they are, and choose words that read well once glued: `"Награда: до " + 63 + " очков"` becomes `"Reward: up to " + 63 + " points"`.
4. **Keep as they are:** chord names (`Am`, `Cmaj7`, `F#m7b5`, `G7`, `Dm9`), note letters, numbers, everything already in Latin letters: the names of Ableton's devices, knobs, menus and buttons (`Reverb`, `Decay`, `Dry/Wet`, `Auto Filter`, `Drum Rack`, `Arm`, `Back to Arrangement`), names of artists and tracks, the `|` separators and their number.
5. **Case.** Write normal sentence case (the program makes capitals itself). Items that are already in capitals stay in capitals. A chord name keeps its exact letters: `Am`, not `AM`.
6. Russian has three forms of a counted noun: `урок` (1), `урока` (2-4), `уроков` (5 and more). Translate the first as the singular and the other two as the plural.

## Style

Speak to the player directly and plainly, in the imperative, the way a good teacher does: "Press the lit key.", "Hold the chord and play the tune over it." Short sentences. British spelling (colour, practise as a verb). Keep the jokes and the warmth where the Russian has them. No exclamation marks the Russian does not have.

## Glossary (use these words, so all parts agree)

The trainer itself:
- ступень (one of the 40 on the path) = level; урок = lesson; шаг (of a lesson) = step; путь = path; курс = course; тренировка = drill
- свободный режим, свободная игра = free play; тренер = coach; задание = task; совет = tip; настроение = mood; стиль = style
- очки = points; награда = reward; комбо = combo; серия = streak; ранг = rank; ошибка = mistake
- сцена (where the dancers are) = stage; танцоры = dancers
- Banners: КАКОФОНИЯ! = CACOPHONY!, ОЙ... = OOPS..., КРУТО! = NICE!, ОГОНЬ! = FIRE!, КОСМОС! = COSMOS!, ВИРТУОЗ! = VIRTUOSO!, ЛЕГЕНДА! = LEGEND!, ЕСТЬ! = YES!, УРОК ПРОЙДЕН! = LESSON DONE!
- Buttons: СТАРТ = START, ДАЛЬШЕ = NEXT, ГОТОВО = DONE, ЗАНОВО = AGAIN, ПОСЛУШАТЬ = LISTEN, СВОБОДНО = FREE PLAY, УРОКИ = LESSONS, ГАММА = SCALE, АККОРД = CHORD
- Legend: МАЖОР = MAJOR, МИНОР = MINOR, ЧУЖИЕ = OTHERS, НАЖАТЬ = PRESS, ВЕРНО = RIGHT, ЛИШНЯЯ = EXTRA, ОПОРНЫЕ = HOME, КРАСКА = COLOUR, МИМО = OFF, КУДА ИДТИ = GO HERE

Notes and harmony:
- Note names in words become letters: до = C, ре = D, ми = E, фа = F, соль = G, ля = A, си = B; диез = sharp (`до-диез` = C sharp, `ДО#` = C#), бемоль = flat (`си-бемоль` = B flat)
- клавиша = key; белые, чёрные клавиши = white, black keys; тональность = key (say "the key of G" where it could be confused with a key of the keyboard)
- аккорд = chord; трезвучие = triad; септаккорд = seventh chord; нонаккорд = ninth chord; обращение = inversion; прогрессия = progression; каденция = cadence; разрешение = resolution
- лад = mode; гамма = scale; тоника = tonic; опорные ноты (the notes of the chord that sounds now) = home notes; краска лада, нота-краска = colour note; мимо лада = outside the mode
- мажор = major; минор = minor; пентатоника = pentatonic; блюзовая гамма = blues scale
- интервал = interval; секунда, терция, кварта, квинта, секста, септима, октава = second, third, fourth, fifth, sixth, seventh, octave; полутон = semitone; тон = whole tone
- мелодия = melody; бас = bass; мотив = motif; фраза = phrase; секвенция = sequence; арпеджио = arpeggio; пробежка = run; многоголосие = part writing; полифония = polyphony; хроматика = chromatics
- левая, правая рука = left, right hand; нажми = press; отпусти = let go; держи = hold; возьми аккорд = take the chord

Rhythm and drums:
- такт = bar; доля = beat; сильная доля = strong beat; слабая доля, между долями = offbeat, between the beats; темп = tempo; ритм = rhythm; ровно = evenly, in time
- восьмые, шестнадцатые, четверти = eighths, sixteenths, quarters; триоль = triplet; синкопа = syncopation; свинг = swing; шаффл = shuffle; сбивка = fill; брейк = break
- бочка = kick; снейр = snare; хэт = hi-hat (ХЭТ = HAT); открытый хэт = open hat; клэп = clap; том = tom; тарелка = cymbal; рим = rim; крэш = crash; шейкер = shaker; бубен = tambourine; ковбелл = cowbell; конги = congas
- пэд (of the keyboard, a drum pad) = pad; пэд (a soft sustained synth sound) = pad
- Three-letter labels of pads stay three characters: БОЧ = KIK, СНР = SNR, КЛП = CLP, ТМ2 = TM2, ОТК = OPN, КРШ = CRS

Ableton and sound:
- дорожка = track; клип = clip; сцена (a row of clips in Session view) = scene; лента (the Arrangement view) = arrangement; сетка = grid; петля = loop; локатор = locator
- устройство = device; ручка = knob; режим = mode; посыл = send; возврат = return track; главная дорожка = Main track; автоматизация = automation; запись = recording
- браузер = browser; перетащи = drag; щёлкни = click; дважды щёлкни = double-click
- фильтр = filter; огибающая = envelope; генератор = oscillator; волна = wave; пила = saw; синус, синусоида = sine; перегруз = overdrive; эхо = echo; пространство = space
- звук = sound; набор (of drums) = kit; сведение = mixing

Styles of music keep their usual English names (Лоу-фай = Lo-fi, Драм-н-бейс = Drum and bass, Берлинская школа = Berlin school, Джаз-рок = Jazz-rock, Ритм-н-блюз = Rhythm and blues, Соул 60-х = Soul of the 60s).

## When you finish

Report in a few lines: the part number, that the check prints OK, and the numbers of the items you are least sure of with a word on why (a piece whose use you could not find, a pun that did not survive, a text you had to shorten a lot).
