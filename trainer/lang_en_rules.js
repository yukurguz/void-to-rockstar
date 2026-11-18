// English for the lines that neither the table of lang_en.js nor the gluing
// of its pieces gets right. A rule is a pattern over the line in capitals, as
// it is about to be drawn, and a function that gives the line in English.
// english() of smk_trainer.js tries the table first, then these rules (the
// first that fits), then the gluing.
(function () {
    function rule(pattern, make) {
        EN_RULES.push([pattern, make]);
    }

    // A row of notes named in words: "ЛЯ - ДО - МИ". Glued from pieces, " ДО "
    // would be taken for the preposition ("up to").
    var NOTE = "(?:ДО|РЕ|МИ|ФА|СОЛЬ|ЛЯ|СИ)(?:#|-ДИЕЗ|-БЕМОЛЬ)?";
    rule(new RegExp("^" + NOTE + "(?: - " + NOTE + ")+$"), function (m) {
        var names = m[0].split(" - ");
        for (var i = 0; i < names.length; i++) {
            names[i] = english(names[i]);
        }
        return names.join(" - ");
    });
}());
