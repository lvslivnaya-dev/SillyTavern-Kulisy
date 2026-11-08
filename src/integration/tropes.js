/**
 * Ready-made tropes: prewritten growth factors that need no model request.
 *
 * A factor of the line "A → B" says what moves A's feeling toward B, so its
 * text is about what B does, or what happens between them — never an order for
 * A to act. Texts name people through placeholders filled with real names when
 * a trope is applied (always in the nominative, so no declension is needed):
 *   {obj}  — B, the one the feeling is about;   {subj} — A, whose feeling it is;
 *   {center}, {rival} — in triangles: the center and the other side.
 *
 * Pair tropes may set a pace per scale (slow caps a change, fast amplifies it —
 * see pacedDelta). Triangle tropes are written in roles — the center and the
 * two sides — and expand to the triangle's directed lines, with an end point.
 */
const PAIR_TROPES = [
  {
    id: 'slowburn', label: 'Слоуберн',
    description: 'Чувства копятся медленно, из мелочей: взгляд, разговор, сдержанное слово. Ни одна сцена не делает их любовью сразу — только долгая цепочка доказательств, что рядом с ним безопасно.',
    pace: { love: 'slow', attraction: 'slow', affection: 'slow' },
    factors: [
      ['affection', 'up', '{obj} замечает мелочи — что {s:он|она} любит, когда {s:ему|ей} плохо — и молча отвечает заботой'],
      ['trust', 'up', '{obj} держит обещания, даже мелкие и неудобные'],
      ['trust', 'up', '{obj} хранит доверенное {s:ему|ей} и не пользуется этим'],
      ['attraction', 'up', '{obj} случайно касается или задерживает взгляд — и оба делают вид, что ничего не было'],
      ['love', 'up', '{obj} открывает свою уязвимость именно {s:ему|ей}, а не другим'],
      ['friendship', 'up', 'Долгие разговоры наедине, в которых {obj} слушает, а не ждёт своей очереди'],
      ['love', 'down', '{obj} торопит события, давит на чувства, требует ответа'],
      ['trust', 'down', '{obj} нарушает личные границы или смеётся над сказанным всерьёз'],
      ['affection', 'down', '{obj} пропадает без объяснений, когда {o:был нужен|была нужна}'],
    ],
  },
  {
    id: 'enemies-to-lovers', label: 'От ненависти до любви',
    description: 'Вражда, в которой уважение прорастает раньше симпатии: достойный противник, потом вынужденный союзник, потом тот, без кого уже пусто. Злость не исчезает сразу — она меняет вкус.',
    factors: [
      ['respect', 'up', '{obj} показывает силу, ум или мастерство в столкновении'],
      ['hostility', 'down', '{obj} прикрывает {s:ему|ей} спину в настоящей опасности, хотя {o:мог|могла} бы бросить'],
      ['attraction', 'up', '{obj} в стычке оказывается слишком близко, и злость переходит в напряжённое молчание'],
      ['trust', 'up', 'В вынужденном сотрудничестве {obj} не предаёт, хотя был шанс'],
      ['resentment', 'down', '{obj} признаёт свою неправоту прямо, без увёрток'],
      ['love', 'up', '{obj} видит в {s:нём|ней} то, чего не замечают другие, и говорит об этом'],
      ['hostility', 'up', '{obj} унижает {s:его|её} при свидетелях'],
      ['resentment', 'up', '{obj} бьёт по больному: прошлому, семье, слабости'],
      ['trust', 'down', '{obj} возвращается к старой игре и использует {s:его|её}'],
    ],
  },
  {
    id: 'lovers-to-enemies', label: 'От любви до ненависти',
    description: 'Любовь, которую по капле разъедают ложь, предательство и равнодушие. Ненависть тем горячее, чем сильнее было чувство: тот, кого любили, знает, куда бить.',
    factors: [
      ['resentment', 'up', '{obj} предаёт доверие или выдаёт {s:его|её} тайну'],
      ['trust', 'down', '{obj} лжёт и действует из скрытых мотивов'],
      ['hostility', 'up', '{obj} встаёт на сторону {s:его|её} врага или соперника'],
      ['love', 'down', '{obj} {o:равнодушен|равнодушна} к {s:его|её} боли'],
      ['affection', 'down', '{obj} пренебрегает {s:им|ею} на людях, стыдится {s:его|её}'],
      ['jealousy', 'up', '{obj} сближается с кем-то другим у {s:него|неё} на глазах'],
      ['love', 'up', '{obj} на миг становится {o:прежним|прежней} — и от этого только больнее'],
      ['hostility', 'down', '{obj} искренне просит прощения и платит за сделанное'],
    ],
  },
  {
    id: 'friends-to-lovers', label: 'Из друзей в возлюбленные',
    description: 'Давняя дружба, в которой всё уже есть — кроме слова. Друг вдруг видится по-новому, и страшно потерять то, что было, ради того, что может быть.',
    factors: [
      ['friendship', 'up', '{obj} хранит их общие шутки, привычки и маленькие традиции'],
      ['attraction', 'up', '{obj} показывается с новой стороны: смелость, внешность, забота о других'],
      ['jealousy', 'up', '{obj} не отказывает сразу, когда кто-то другой проявляет интерес'],
      ['love', 'up', '{obj} выбирает {s:его|её} в трудную минуту, а не других'],
      ['trust', 'up', '{obj} остаётся {o:тем же другом|той же подругой} и после намёка на чувства'],
      ['affection', 'up', '{obj} помнит, как было раньше, и бережёт это'],
      ['friendship', 'down', 'После намёка на чувства {obj} неловко избегает {s:его|её}'],
      ['love', 'down', '{obj} называет их «просто друзьями» при всех'],
    ],
  },
  {
    id: 'fast-passion', label: 'Страсть с разгона',
    description: 'Физическая близость вспыхивает сразу, и чувства догоняют её так же быстро: всё горит ярко — и может так же быстро сгореть.',
    pace: { attraction: 'fast', love: 'fast', affection: 'fast', dependency: 'fast' },
    factors: [
      ['attraction', 'up', '{obj} флиртует, касается, ищет уединённой близости'],
      ['love', 'up', 'После близости {obj} остаётся рядом и {o:нежен|нежна}'],
      ['affection', 'up', '{obj} заботится наутро, не исчезает'],
      ['dependency', 'up', '{obj} ищет встречи снова и снова'],
      ['jealousy', 'up', '{obj} благосклонно принимает чужой интерес'],
      ['trust', 'up', '{obj} не стыдится их на людях'],
      ['love', 'down', '{obj} {o:холоден и равнодушен|холодна и равнодушна} после близости'],
      ['resentment', 'up', '{obj} ведёт себя так, будто ничего не было'],
    ],
  },
  {
    id: 'body-first', label: 'Сначала тело, потом сердце',
    description: 'Тянет сразу и сильно, а доверие и любовь растут медленно и трудно. Близость есть, а разговоров нет — и именно они решают, станет ли это чем-то большим.',
    pace: { attraction: 'fast', love: 'slow', trust: 'slow', affection: 'slow' },
    factors: [
      ['attraction', 'up', '{obj} оказывается рядом — случайная или намеренная близость, напряжение'],
      ['love', 'up', 'Редкие моменты, когда {obj} открывается не в постели'],
      ['trust', 'up', '{obj} остаётся, когда {o:мог|могла} бы уйти'],
      ['affection', 'up', '{obj} интересуется {s:им самим|ею самой}, а не только телом'],
      ['trust', 'down', '{obj} использует близость как оружие или способ уйти от разговора'],
      ['love', 'down', '{obj} сводит всё только к телу'],
      ['resentment', 'up', '{obj} обращается с {s:ним|ней} так, что {s:он|она} чувствует себя {s:использованным|использованной}'],
    ],
  },
  {
    id: 'forbidden', label: 'Запретная любовь',
    description: 'Чувства под запретом: семья, клан, правила, чужое кольцо. Каждая встреча — риск, каждая ложь близким — вина, и именно это делает связь такой сильной.',
    factors: [
      ['love', 'up', '{obj} приходит на тайную встречу вопреки запрету'],
      ['fear', 'up', '{obj} рискует, и опасность разоблачения растёт'],
      ['dependency', 'up', '{obj} принимает {s:его настоящим|её настоящей}, как больше никто'],
      ['guilt', 'up', '{obj} зовёт на встречи, ради которых приходится обманывать близких'],
      ['trust', 'up', '{obj} берёт риск на себя, чтобы прикрыть {s:его|её}'],
      ['attraction', 'up', '{obj} рядом на людях — и нельзя даже коснуться'],
      ['trust', 'down', '{obj} скрывает правду, которая касается их обоих'],
      ['love', 'down', '{obj} отступает, как только становится опасно'],
    ],
  },
  {
    id: 'rivals-to-allies', label: 'Соперники → союзники',
    description: 'Соперничество, в котором честная борьба и общий враг рождают уважение, а потом и союз. Спорить не перестанут — но спиной друг к другу встанут.',
    factors: [
      ['respect', 'up', '{obj} побеждает честно или проигрывает достойно'],
      ['hostility', 'down', '{obj} идёт против того же врага, к той же цели'],
      ['trust', 'up', '{obj} прикрывает {s:его|её} в бою или в споре'],
      ['approval', 'up', '{obj} поступает по тем же принципам, что и {s:он|она}'],
      ['friendship', 'up', '{obj} делится тем, что знает, без торга'],
      ['respect', 'down', '{obj} жульничает или бьёт исподтишка'],
      ['hostility', 'up', '{obj} присваивает себе общую победу'],
    ],
  },
  {
    id: 'protector', label: 'Защитник',
    description: 'Один оберегает другого, и каждый риск только крепче связывает. Опасность в том, что забота легко становится клеткой.',
    factors: [
      ['trust', 'up', '{obj} защищает {s:его|её} без просьбы'],
      ['affection', 'up', '{obj} заботится о {s:его|её} ранах и усталости'],
      ['dependency', 'up', '{obj} решает {s:его|её} проблемы за {s:него|неё}'],
      ['love', 'up', '{obj} рискует собой ради {s:него|неё}'],
      ['guilt', 'up', '{obj} {o:пострадал|пострадала}, защищая {s:его|её}'],
      ['approval', 'down', '{obj} безрассудно рискует собой'],
      ['resentment', 'up', '{obj} опекает так, будто {s:он|она} ни на что не {s:способен|способна}'],
      ['trust', 'down', '{obj} не {o:пришёл|пришла}, когда {o:был нужен|была нужна}'],
    ],
  },
  {
    id: 'second-chance', label: 'Второй шанс',
    description: 'Бывшие, которых снова свело. Между ними старая боль и старая любовь: одному придётся доказать, что изменился, другому — решить, готов ли поверить снова.',
    factors: [
      ['guilt', 'up', '{obj} напоминает, как когда-то {o:был ранен|была ранена} {s:им|ею}'],
      ['love', 'up', '{obj} вспоминает их лучшее время'],
      ['resentment', 'down', '{obj} искренне извиняется, без оправданий'],
      ['trust', 'up', '{obj} раз за разом доказывает, что {o:изменился|изменилась}'],
      ['affection', 'up', '{obj} помнит о {s:нём|ней} то, чего не знает никто другой'],
      ['trust', 'down', '{obj} повторяет старую ошибку'],
      ['resentment', 'up', '{obj} ведёт себя так, будто прошлого не было'],
      ['jealousy', 'up', '{obj} за это время {o:построил|построила} другую жизнь'],
    ],
  },
  {
    id: 'obsession', label: 'Одержимость',
    description: 'Одержимость: мысли возвращаются к нему снова и снова, любое его внимание — награда, любое внимание к другим — угроза. Это не любовь, а голод, и растёт он быстро. Отказ не гасит его, а распаляет; остудить может лишь долгая, твёрдая дистанция.',
    pace: { dependency: 'fast', jealousy: 'fast', attraction: 'fast' },
    factors: [
      ['dependency', 'up', '{obj} дарит хоть каплю внимания: взгляд, улыбку, ответ'],
      ['attraction', 'up', '{obj} рядом, на расстоянии вытянутой руки, и не замечает, как на {o:него|неё} смотрят'],
      ['jealousy', 'up', '{obj} уделяет внимание кому-то другому'],
      ['love', 'up', '{obj} делает что-то только для {s:него|неё} — и это кажется знаком'],
      ['dependency', 'up', '{obj} пропадает из виду — тревога и потребность найти растут'],
      ['resentment', 'up', '{obj} отвергает {s:его|её} или смеётся над {s:его|её} чувствами'],
      ['hostility', 'up', '{obj} пытается уйти, сбежать или запретить приближаться'],
      ['trust', 'down', '{obj} скрывает, где {o:был|была} и с кем'],
      ['approval', 'down', '{obj} строит жизнь, в которой {s:ему|ей} нет места'],
      ['dependency', 'down', '{obj} долго и твёрдо держит дистанцию, и это не игра'],
      ['jealousy', 'down', '{obj} {o:сам|сама} ищет {s:его|её} общества, и никого другого рядом нет'],
    ],
  },
  {
    id: 'obsessed-over', label: 'Под чужой одержимостью',
    description: 'Линия того, кем одержимы: другой слишком близко, слишком много знает, всегда оказывается рядом. Сначала это льстит или пугает, потом пугает всё сильнее — или затягивает.',
    factors: [
      ['fear', 'up', '{obj} знает о {s:нём|ней} то, чего не {o:должен|должна} знать'],
      ['fear', 'up', '{obj} оказывается рядом там, где {o:его|её} не ждали'],
      ['trust', 'down', '{obj} следит, проверяет, роется в {s:его|её} вещах или переписке'],
      ['resentment', 'up', '{obj} отваживает от {s:него|неё} друзей и близких'],
      ['dependency', 'up', '{obj} решает {s:его|её} проблемы так, что без {o:него|неё} уже не обойтись'],
      ['attraction', 'up', '{obj} напирает и осыпает вниманием — пугающе, но лестно'],
      ['guilt', 'up', '{obj} страдает из-за {s:его|её} отказа и показывает это'],
      ['hostility', 'up', '{obj} переходит черту: угрожает, удерживает, вредит'],
      ['fear', 'down', '{obj} отступает, когда {o:его|её} просят, и держит слово'],
    ],
  },
  {
    id: 'violence-victim', label: 'Насилие: тот, кто терпит',
    description: 'Линия того, кто терпит насилие: страх, ловушка зависимости, вспышки обиды и ложное облегчение после «извинений». Тепло здесь не исцеляет, а держит на крючке.',
    factors: [
      ['fear', 'up', '{obj} угрожает, бьёт, срывается в ярость'],
      ['trust', 'down', '{obj} повторяет насилие после обещаний, что больше не будет'],
      ['dependency', 'up', '{obj} изолирует {s:его|её}: «кроме меня у тебя никого нет»'],
      ['affection', 'up', '{obj} после вспышки становится редкостно {o:нежен|нежна} — ловушка привязанности'],
      ['resentment', 'up', '{obj} унижает и контролирует каждый шаг'],
      ['guilt', 'up', '{obj} убеждает, что {s:он сам|она сама} во всём {s:виноват|виновата}'],
      ['hostility', 'up', '{obj} доводит до точки, когда хочется дать отпор или уйти'],
      ['fear', 'down', '{obj} далеко, а рядом те, кто защитит'],
    ],
  },
  {
    id: 'violence-aggressor', label: 'Насилие: тот, кто применяет',
    description: 'Линия того, кто контролирует и причиняет боль: собственничество, ярость на любое неповиновение и редкие уколы вины, которые ничего не меняют.',
    factors: [
      ['jealousy', 'up', '{obj} подпускает к себе кого-то другого'],
      ['dependency', 'up', '{obj} отдаляется — страх потерять контроль'],
      ['hostility', 'up', '{obj} не подчиняется или пытается уйти'],
      ['guilt', 'up', '{obj} показывает последствия {s:его|её} вспышки: синяки, слёзы, страх'],
      ['approval', 'down', '{obj} проявляет независимость'],
      ['respect', 'down', '{obj} боится и покоряется'],
      ['respect', 'up', '{obj} даёт твёрдый отпор, и это {s:его|её} останавливает'],
    ],
  },
];

/** Roles: center, side (either of the two), rival (the other side). Factor: [from, to, scale, direction, text]. */
const TRIANGLE_TROPES = [
  {
    id: 'love-triangle', label: 'Любовный треугольник: выбор',
    description: 'Две стороны борются за чувства центра; центр постепенно делает выбор. Каждый поступок сторон — довод в этом выборе, а ревность между ними растёт вместе со ставками.',
    goal: 'Центр постепенно делает выбор между двумя; выбор созревает через события, а не объявляется. Сторона, которую не выбрали, получает свою развязку.',
    factors: [
      ['side', 'center', 'love', 'up', '{center} выбирает {s:его|её}, а {rival} остаётся в стороне'],
      ['side', 'center', 'jealousy', 'up', '{center} и {rival} проводят время вдвоём'],
      ['side', 'center', 'resentment', 'up', '{center} тянет с выбором и держит обоих рядом'],
      ['side', 'rival', 'jealousy', 'up', '{rival} и {center} сближаются'],
      ['side', 'rival', 'respect', 'up', '{rival} поступает благородно, хотя {r:мог|могла} бы выиграть подлостью'],
      ['side', 'rival', 'hostility', 'up', '{rival} играет нечестно, чтобы {s:его|её} оттеснить'],
      ['center', 'side', 'love', 'up', '{obj} понимает {center} лучше, чем {rival}, и показывает это поступком'],
      ['center', 'side', 'trust', 'down', '{obj} давит, требует выбора, ставит ультиматум'],
      ['center', 'side', 'guilt', 'up', '{obj} страдает из-за того, что выбор не в {o:его|её} пользу'],
    ],
  },
  {
    id: 'rivals-for-attention', label: 'Соперничество за внимание',
    description: 'Не романтическое соперничество за внимание и признание центра: ученики одного учителя, братья одного отца, бойцы одного лидера.',
    goal: 'Соперники проходят путь от борьбы за внимание центра к признанию друг друга.',
    factors: [
      ['side', 'rival', 'hostility', 'up', '{rival} перехватывает внимание, которое {center} {c:мог|могла} бы отдать {s:ему|ей}'],
      ['side', 'rival', 'respect', 'up', '{rival} побеждает честно'],
      ['side', 'rival', 'friendship', 'up', '{rival} помогает {s:ему|ей}, хотя {r:мог|могла} бы обойти'],
      ['side', 'center', 'affection', 'up', '{center} замечает и хвалит {s:его|её}'],
      ['side', 'center', 'resentment', 'up', '{center} не замечает {s:его|её} стараний'],
      ['side', 'center', 'approval', 'down', '{center} открыто выделяет другого — {rival}'],
      ['center', 'side', 'approval', 'up', '{obj} ведёт себя достойно в соперничестве'],
      ['center', 'side', 'approval', 'down', '{obj} подставляет соперника, чтобы выиграть'],
    ],
  },
  {
    id: 'united-front', label: 'Двое как одно целое',
    description: 'Две стороны действуют сообща, дополняют друг друга и делят связь с центром без ревности. Их сила — в слаженности, их слабость — в тайнах друг от друга.',
    goal: 'Двое становятся для центра единым целым: дополняют друг друга, а не соперничают; связь троих держится на доверии, без ревности.',
    factors: [
      ['side', 'rival', 'trust', 'up', '{rival} прикрывает и дополняет {s:его|её} действия'],
      ['side', 'rival', 'friendship', 'up', '{rival} действует по общему плану, слаженно, без слов'],
      ['side', 'rival', 'jealousy', 'down', '{center} и {rival} сближаются — и это радует, а не задевает'],
      ['side', 'rival', 'trust', 'down', '{rival} действует за {s:его|её} спиной'],
      ['side', 'center', 'affection', 'up', '{center} принимает их обоих, не выбирая одного'],
      ['side', 'center', 'trust', 'up', '{center} не стравливает их между собой'],
      ['side', 'center', 'resentment', 'up', '{center} отдаёт предпочтение одному из них'],
      ['center', 'side', 'trust', 'up', '{obj} и {rival} действуют слаженно ради {s:него|неё}'],
    ],
  },
  {
    id: 'found-family', label: 'Трое против мира',
    description: 'Трое становятся друг другу семьёй и держатся вместе против всех. Чужие для них — все остальные; предательство внутри страшнее любого врага.',
    goal: 'Трое становятся друг другу семьёй: доверяют без оглядки и держатся вместе.',
    factors: [
      ['side', 'center', 'friendship', 'up', '{center} проходит с {s:ним|ней} через общие испытания'],
      ['side', 'center', 'family', 'up', '{center} защищает {s:его|её}, как защищают своих, не задумываясь'],
      ['center', 'side', 'trust', 'up', '{obj} держит сторону своих перед чужими'],
      ['center', 'side', 'affection', 'up', 'Маленькие ритуалы, которые есть только у них троих'],
      ['side', 'rival', 'friendship', 'up', '{rival} помогает {s:ему|ей}, пока {center} далеко'],
      ['side', 'rival', 'family', 'up', '{rival} заступается за {s:него|неё} перед чужими'],
      ['side', 'rival', 'trust', 'down', '{rival} скрывает от остальных важное'],
      ['center', 'side', 'trust', 'down', '{obj} выбирает чужих вместо своих'],
    ],
  },
];

const NAME_FALLBACK = Object.freeze({ obj: 'другой', subj: 'он', center: 'центр', rival: 'соперник' });
const ROLE_OF = Object.freeze({ s: 'subj', o: 'obj', c: 'center', r: 'rival' });

/**
 * Fill a trope text for real people.
 * people: { subj, obj, center, rival } — each a name string or { name, gender: 'male'|'female' }.
 * {obj} → the name (nominative); {o:был|была} → the form for obj's gender, "был/была" when unknown.
 */
export function fillTropeText(text, people = {}) {
  const person = role => (typeof people[role] === 'string' ? { name: people[role] } : people[role] ?? {});
  const filled = String(text)
    .replace(/\{(obj|subj|center|rival)\}/g, (_, role) => String(person(role).name || NAME_FALLBACK[role]))
    .replace(/\{([socr]):([^|{}]*)\|([^|{}]*)\}/g, (_, key, male, female) => {
      const gender = person(ROLE_OF[key]).gender;
      return gender === 'male' ? male : gender === 'female' ? female : `${male}/${female}`;
    });
  return filled.charAt(0).toLocaleUpperCase('ru-RU') + filled.slice(1);
}

export const PACE_LABELS = Object.freeze({ fast: 'быстро', slow: 'медленно' });

export function pairTropes() {
  return PAIR_TROPES.map(({ id, label, description, pace }) => ({ id, label, description, pace: { ...(pace ?? {}) } }));
}

export function triangleTropes() {
  return TRIANGLE_TROPES.map(({ id, label, description, goal }) => ({ id, label, description, goal }));
}

/**
 * Factors of a pair trope for one directed line; scales missing from the chat are skipped.
 * names: { subj, obj } — the line's characters, put into the texts.
 */
export function pairTropeFactors(tropeId, scaleIds, names = {}) {
  const trope = PAIR_TROPES.find(item => item.id === tropeId);
  if (!trope) throw new Error('Троп не найден.');
  const known = new Set(scaleIds);
  return trope.factors
    .filter(([scaleId]) => known.has(scaleId))
    .map(([scaleId, direction, text]) => ({ scaleId, direction, text: fillTropeText(text, names) }));
}

/** Pace a pair trope sets on a line, limited to scales the chat has. */
export function pairTropePace(tropeId, scaleIds) {
  const trope = PAIR_TROPES.find(item => item.id === tropeId);
  if (!trope) throw new Error('Троп не найден.');
  const known = new Set(scaleIds);
  return Object.fromEntries(Object.entries(trope.pace ?? {}).filter(([scaleId]) => known.has(scaleId)));
}

/**
 * Expand a triangle trope to directed lines.
 * Returns { goal, factors: [{ from, to, scaleId, direction, text }] }; lines whose
 * subject is the persona are skipped (the persona's own feelings are not tracked).
 * nameOf(id) puts names into the texts.
 */
export function triangleTropeFactors(tropeId, triangle, scaleIds, personaId = '', nameOf = () => '') {
  const trope = TRIANGLE_TROPES.find(item => item.id === tropeId);
  if (!trope) throw new Error('Троп не найден.');
  const known = new Set(scaleIds);
  const sides = [triangle.firstId, triangle.secondId];
  const factors = [];
  for (const [fromRole, toRole, scaleId, direction, raw] of trope.factors) {
    if (!known.has(scaleId)) continue;
    for (const side of sides) {
      const rival = side === sides[0] ? sides[1] : sides[0];
      const resolve = role => (role === 'center' ? triangle.centerId : role === 'side' ? side : rival);
      const from = resolve(fromRole);
      const to = resolve(toRole);
      if (from === to || (personaId && from === personaId)) continue;
      const text = fillTropeText(raw, { subj: nameOf(from), obj: nameOf(to), center: nameOf(triangle.centerId), rival: nameOf(rival) });
      if (factors.some(factor => factor.from === from && factor.to === to && factor.scaleId === scaleId && factor.direction === direction && factor.text === text)) continue;
      factors.push({ from, to, scaleId, direction, text });
    }
  }
  return { goal: trope.goal, factors };
}

/** Name of a trope by a factor origin ("pair-trope:slowburn"), for badges in the editors. */
export function tropeLabel(origin) {
  const [kind, id] = String(origin ?? '').split(':');
  const list = kind === 'pair-trope' ? PAIR_TROPES : [...TRIANGLE_TROPES, ...PAIR_TROPES];
  return list.find(item => item.id === id)?.label ?? '';
}
