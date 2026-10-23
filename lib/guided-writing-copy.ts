import type { StarterId } from './guided-open-letter'
export type WritingLocale = 'en' | 'fr' | 'es' | 'pt'
export function writingLocale(locale: string): WritingLocale {
  return locale === 'fr' || locale === 'es' || locale === 'pt' ? locale : 'en'
}
export type GuidedWritingCopy = typeof GUIDED_WRITING_COPY.en
export const GUIDED_WRITING_COPY = {
  "en": {
    "stepNames": [
      "Choose a thought",
      "Put it into words",
      "Your letter"
    ],
    "freely": "Write without guidance",
    "yourLetter": "Your open letter",
    "hChoose": "Every ordinary life has a story.",
    "hAnswer": "Tell it in your own words.",
    "hReview": "You’ve started a letter.",
    "dChoose": "Choose something that feels familiar. You can change your mind.",
    "dAnswer": "A few sentences are enough. Skip anything you don’t want to share.",
    "dReview": "Every word is yours. Edit the title and every paragraph before publishing.",
    "openingSaved": "Opening your saved writing…",
    "minAnswer": "Write at least one thought of about 20 characters, or choose another subject.",
    "existingError": "You already have a saved letter. Continue it, or choose to replace it with this draft.",
    "storageError": "Your browser could not save the draft. Please check storage before leaving this page.",
    "somethingElse": "Something else — write freely",
    "ofThree": "of 3",
    "answerPlaceholder": "Write whatever comes to mind…",
    "back": "Back",
    "seeLetter": "See my letter",
    "continue": "Continue",
    "skip": "Skip this question",
    "existingWarning": "You already have a saved open-letter draft. We won’t overwrite it without your permission.",
    "continueSaved": "Continue saved letter",
    "replace": "Use these answers instead",
    "editAnswers": "Edit my answers",
    "editor": "Continue in the letter editor",
    "nothingPublished": "Nothing has been published. Preview and publishing remain your choice.",
    "deviceOnly": "Your writing stays on this device until you choose to publish it.",
    "themes": {
      "ordinary-day": {
        "title": "An ordinary day",
        "opening": "Something small happened recently that I keep thinking about…",
        "prompts": [
          "What happened?",
          "Why did it stay with you?",
          "What would you like someone else to tell you about?"
        ],
        "draftTitle": "A small moment from my day"
      },
      "someone-i-remember": {
        "title": "Someone I remember",
        "opening": "There’s someone I remember more often than they probably realize…",
        "prompts": [
          "Who comes to mind? You can leave out their name.",
          "What small detail about them do you remember?",
          "Does this remind you of someone in your life, too?"
        ],
        "draftTitle": "Someone I still remember"
      },
      "a-place": {
        "title": "A place I carry with me",
        "opening": "There’s a place I haven’t been to in years, but I still remember…",
        "prompts": [
          "Which place are you thinking of?",
          "What detail makes it feel vivid to you?",
          "Is there a place you still carry with you?"
        ],
        "draftTitle": "A place I carry with me"
      },
      "something-i-wonder": {
        "title": "Something I’ve been wondering",
        "opening": "I wonder whether other people ever feel this way…",
        "prompts": [
          "What have you been wondering about lately?",
          "What made you start thinking about it?",
          "What would you like someone else’s perspective on?"
        ],
        "draftTitle": "Something I’ve been wondering"
      }
    }
  },
  "fr": {
    "stepNames": [
      "Choisir une idée",
      "Trouver les mots",
      "Votre lettre"
    ],
    "freely": "Écrire sans aide",
    "yourLetter": "Votre lettre ouverte",
    "hChoose": "Chaque vie ordinaire a son histoire.",
    "hAnswer": "Racontez-la avec vos mots.",
    "hReview": "Votre lettre prend forme.",
    "dChoose": "Choisissez un sujet qui vous parle. Vous pourrez changer d’avis.",
    "dAnswer": "Quelques phrases suffisent. Vous pouvez passer une question.",
    "dReview": "Chaque mot vous appartient. Modifiez le titre et les paragraphes avant de publier.",
    "openingSaved": "Ouverture de votre brouillon…",
    "minAnswer": "Écrivez au moins une pensée de vingt caractères environ, ou choisissez un autre sujet.",
    "existingError": "Vous avez déjà un brouillon. Continuez-le ou choisissez de le remplacer.",
    "storageError": "Votre navigateur ne peut pas enregistrer ce brouillon. Vérifiez le stockage avant de quitter la page.",
    "somethingElse": "Autre chose — écrire librement",
    "ofThree": "sur 3",
    "answerPlaceholder": "Écrivez ce qui vous vient à l’esprit…",
    "back": "Retour",
    "seeLetter": "Voir ma lettre",
    "continue": "Continuer",
    "skip": "Passer cette question",
    "existingWarning": "Vous avez déjà une lettre enregistrée. Nous ne la remplacerons pas sans votre accord.",
    "continueSaved": "Continuer le brouillon",
    "replace": "Utiliser ces réponses",
    "editAnswers": "Modifier mes réponses",
    "editor": "Continuer dans l’éditeur",
    "nothingPublished": "Rien n’a été publié. Vous choisissez quand prévisualiser et publier.",
    "deviceOnly": "Votre brouillon reste sur cet appareil jusqu’à publication.",
    "themes": {
      "ordinary-day": {
        "title": "Un jour ordinaire",
        "opening": "Une petite chose récente me revient souvent…",
        "prompts": [
          "Que s’est-il passé ?",
          "Pourquoi ce moment vous a-t-il marqué ?",
          "Qu’aimeriez-vous savoir de la vie de quelqu’un d’autre ?"
        ],
        "draftTitle": "Un petit moment de ma journée"
      },
      "someone-i-remember": {
        "title": "Une personne dont je me souviens",
        "opening": "Il y a quelqu’un à qui je pense encore souvent…",
        "prompts": [
          "À qui pensez-vous ? Son nom n’est pas nécessaire.",
          "Quel petit détail gardez-vous en mémoire ?",
          "Cette personne vous en rappelle-t-elle une autre ?"
        ],
        "draftTitle": "Une personne dont je me souviens"
      },
      "a-place": {
        "title": "Un lieu que je garde en moi",
        "opening": "Je n’ai pas revu cet endroit depuis des années…",
        "prompts": [
          "À quel lieu pensez-vous ?",
          "Quel détail le rend si vivant dans votre mémoire ?",
          "Quel lieu portez-vous encore en vous ?"
        ],
        "draftTitle": "Un lieu que je garde en moi"
      },
      "something-i-wonder": {
        "title": "Une question que je me pose",
        "opening": "Je me demande parfois si d’autres ressentent cela…",
        "prompts": [
          "À quoi réfléchissez-vous ces derniers temps ?",
          "Qu’est-ce qui vous y a fait penser ?",
          "Quel autre point de vue aimeriez-vous entendre ?"
        ],
        "draftTitle": "Une question que je me pose"
      }
    }
  },
  "es": {
    "stepNames": [
      "Elige una idea",
      "Ponla en palabras",
      "Tu carta"
    ],
    "freely": "Escribir sin ayuda",
    "yourLetter": "Tu carta abierta",
    "hChoose": "Toda vida cotidiana tiene una historia.",
    "hAnswer": "Cuéntala con tus palabras.",
    "hReview": "Tu carta empieza a tomar forma.",
    "dChoose": "Elige algo que te resulte familiar. Puedes cambiar de idea.",
    "dAnswer": "Bastan unas frases. Puedes saltarte cualquier pregunta.",
    "dReview": "Cada palabra es tuya. Podrás editarlo todo antes de publicar.",
    "openingSaved": "Abriendo tu borrador…",
    "minAnswer": "Escribe al menos una idea de unos veinte caracteres o elige otro tema.",
    "existingError": "Ya tienes una carta guardada. Puedes continuarla o reemplazarla por este borrador.",
    "storageError": "Tu navegador no pudo guardar el borrador. Comprueba el almacenamiento antes de salir.",
    "somethingElse": "Otra cosa — escribir libremente",
    "ofThree": "de 3",
    "answerPlaceholder": "Escribe lo que te venga a la mente…",
    "back": "Atrás",
    "seeLetter": "Ver mi carta",
    "continue": "Continuar",
    "skip": "Saltar esta pregunta",
    "existingWarning": "Ya tienes una carta guardada. No la reemplazaremos sin tu permiso.",
    "continueSaved": "Continuar carta guardada",
    "replace": "Usar estas respuestas",
    "editAnswers": "Editar mis respuestas",
    "editor": "Continuar en el editor",
    "nothingPublished": "Todavía no has publicado nada. Tú decides cuándo previsualizar y publicar.",
    "deviceOnly": "Tu borrador se guarda en este dispositivo hasta que decidas publicarlo.",
    "themes": {
      "ordinary-day": {
        "title": "Un día cualquiera",
        "opening": "Pasó algo pequeño que todavía recuerdo…",
        "prompts": [
          "¿Qué ocurrió?",
          "¿Por qué se te quedó grabado?",
          "¿Qué te gustaría que otra persona te contara?"
        ],
        "draftTitle": "Un pequeño momento de mi día"
      },
      "someone-i-remember": {
        "title": "Alguien que recuerdo",
        "opening": "Hay alguien en quien pienso más de lo que imagina…",
        "prompts": [
          "¿Quién te viene a la mente? No hace falta decir su nombre.",
          "¿Qué pequeño detalle recuerdas de esa persona?",
          "¿Te recuerda a alguien de tu vida?"
        ],
        "draftTitle": "Alguien que todavía recuerdo"
      },
      "a-place": {
        "title": "Un lugar que llevo conmigo",
        "opening": "Hace años que no voy a ese lugar, pero lo recuerdo…",
        "prompts": [
          "¿Qué lugar tienes en mente?",
          "¿Qué detalle lo hace tan especial?",
          "¿Qué lugar llevas todavía contigo?"
        ],
        "draftTitle": "Un lugar que llevo conmigo"
      },
      "something-i-wonder": {
        "title": "Algo que me pregunto",
        "opening": "A veces me pregunto si alguien más siente lo mismo…",
        "prompts": [
          "¿En qué has estado pensando últimamente?",
          "¿Por qué empezaste a pensar en ello?",
          "¿Qué perspectiva de otra persona te gustaría conocer?"
        ],
        "draftTitle": "Algo que me pregunto"
      }
    }
  },
  "pt": {
    "stepNames": [
      "Escolher uma ideia",
      "Encontrar palavras",
      "A sua carta"
    ],
    "freely": "Escrever sem ajuda",
    "yourLetter": "A sua carta aberta",
    "hChoose": "Cada vida comum tem uma história.",
    "hAnswer": "Conte-a com as suas palavras.",
    "hReview": "A sua carta começa a ganhar forma.",
    "dChoose": "Escolha algo que lhe seja familiar. Pode mudar de ideias.",
    "dAnswer": "Algumas frases bastam. Pode saltar qualquer pergunta.",
    "dReview": "Cada palavra é sua. Pode editar tudo antes de publicar.",
    "openingSaved": "A abrir o seu rascunho…",
    "minAnswer": "Escreva pelo menos uma ideia com cerca de vinte caracteres ou escolha outro tema.",
    "existingError": "Já tem uma carta guardada. Continue-a ou escolha substituí-la.",
    "storageError": "O navegador não conseguiu guardar o rascunho. Verifique o armazenamento antes de sair.",
    "somethingElse": "Outro assunto — escrever livremente",
    "ofThree": "de 3",
    "answerPlaceholder": "Escreva o que lhe vier à cabeça…",
    "back": "Voltar",
    "seeLetter": "Ver a minha carta",
    "continue": "Continuar",
    "skip": "Saltar esta pergunta",
    "existingWarning": "Já tem uma carta guardada. Não vamos substituí-la sem autorização.",
    "continueSaved": "Continuar carta guardada",
    "replace": "Usar estas respostas",
    "editAnswers": "Editar respostas",
    "editor": "Continuar no editor",
    "nothingPublished": "Nada foi publicado. A pré-visualização e a publicação são sempre uma escolha sua.",
    "deviceOnly": "O rascunho permanece neste dispositivo até decidir publicá-lo.",
    "themes": {
      "ordinary-day": {
        "title": "Um dia comum",
        "opening": "Aconteceu uma pequena coisa em que ainda penso…",
        "prompts": [
          "O que aconteceu?",
          "Porque ficou na sua memória?",
          "O que gostaria que outra pessoa lhe contasse?"
        ],
        "draftTitle": "Um pequeno momento do meu dia"
      },
      "someone-i-remember": {
        "title": "Alguém de quem me lembro",
        "opening": "Há alguém em quem penso mais do que essa pessoa imagina…",
        "prompts": [
          "Quem lhe vem à mente? Não precisa de dizer o nome.",
          "Que pequeno detalhe ainda recorda?",
          "Isso faz-lhe lembrar alguém da sua vida?"
        ],
        "draftTitle": "Alguém de quem ainda me lembro"
      },
      "a-place": {
        "title": "Um lugar que levo comigo",
        "opening": "Há um lugar onde não vou há anos, mas que ainda recordo…",
        "prompts": [
          "Em que lugar está a pensar?",
          "Que detalhe o torna tão vivo na memória?",
          "Há algum lugar que ainda leve consigo?"
        ],
        "draftTitle": "Um lugar que levo comigo"
      },
      "something-i-wonder": {
        "title": "Algo sobre o qual me interrogo",
        "opening": "Às vezes pergunto-me se outras pessoas sentem isto…",
        "prompts": [
          "Em que tem pensado ultimamente?",
          "O que o levou a pensar nisso?",
          "Que perspetiva gostaria de ouvir?"
        ],
        "draftTitle": "Algo sobre o qual me interrogo"
      }
    }
  }
} as const
export function writingThemeCopy(locale: WritingLocale, id: StarterId) {
  return GUIDED_WRITING_COPY[locale].themes[id]
}

export const PROFILE_INTRODUCTION_COPY = {
  "en": {
    "back": "Back to You",
    "eyebrow": "YOUR PUBLIC INTRODUCTION",
    "heading": "A little of you, in your own words.",
    "lead": "Not ready to leave a letter? A short introduction can help another person find a reason to write.",
    "prompts": [
      "What brings you to Tempa?",
      "What is something you enjoy talking or writing about?"
    ],
    "placeholders": [
      "A friendship, a new perspective, a place to write…",
      "Perhaps ordinary days, gardens, places or unexpected thoughts…"
    ],
    "fewWords": "A few more words will help.",
    "editable": "You can edit this any time.",
    "overLimit": "Shorten your introduction to 600 characters.",
    "preview": "HOW OTHERS WILL READ IT",
    "placeholder": "Your words will appear here.",
    "consent": "Sharing is your choice. Only an approved introduction is visible to other members and eligible for matching. You can hide it later. Your private letters are never used.",
    "pending": "Your introduction is awaiting review. It will not appear to others until approved.",
    "visible": "Your introduction is visible to eligible Tempa members.",
    "hidden": "Your introduction is hidden from discovery.",
    "submitted": "Your introduction was submitted for review.",
    "saving": "Saving…",
    "share": "Share my introduction",
    "hide": "Hide introduction",
    "later": "Maybe later",
    "submitError": "Could not submit your introduction. Please try again.",
    "hideError": "Could not hide this introduction.",
    "retry": "Please try again."
  },
  "fr": {
    "back": "Retour à Vous",
    "eyebrow": "VOTRE PRÉSENTATION PUBLIQUE",
    "heading": "Quelques mots sur vous, à votre façon.",
    "lead": "Pas encore prêt à laisser une lettre ? Une courte présentation peut aider quelqu’un à vous découvrir.",
    "prompts": [
      "Pourquoi êtes-vous ici, sur Tempa ?",
      "De quoi aimez-vous parler ou écrire ?"
    ],
    "placeholders": [
      "Une amitié, une nouvelle perspective, le plaisir d’écrire…",
      "Des journées ordinaires, des jardins, des lieux ou des pensées…"
    ],
    "fewWords": "Quelques mots de plus nous aideraient.",
    "editable": "Vous pouvez modifier cela à tout moment.",
    "overLimit": "Limitez votre présentation à 600 caractères.",
    "preview": "APERÇU POUR LES AUTRES",
    "placeholder": "Vos mots apparaîtront ici.",
    "consent": "Vous décidez de partager ou non. Seule une présentation approuvée sera visible par les autres membres et utilisée pour les recommandations. Vous pourrez la masquer. Vos lettres privées ne sont jamais utilisées.",
    "pending": "Votre présentation attend une vérification. Elle reste invisible jusque-là.",
    "visible": "Votre présentation est visible aux membres de Tempa autorisés.",
    "hidden": "Votre présentation est masquée.",
    "submitted": "Votre présentation a été soumise à vérification.",
    "saving": "Enregistrement…",
    "share": "Partager ma présentation",
    "hide": "Masquer ma présentation",
    "later": "Peut-être plus tard",
    "submitError": "Impossible d’envoyer votre présentation. Réessayez.",
    "hideError": "Impossible de masquer votre présentation.",
    "retry": "Veuillez réessayer."
  },
  "es": {
    "back": "Volver a Ti",
    "eyebrow": "TU PRESENTACIÓN PÚBLICA",
    "heading": "Un poco de ti, con tus palabras.",
    "lead": "¿Aún no quieres dejar una carta? Una breve presentación puede ayudar a que alguien tenga ganas de conocerte.",
    "prompts": [
      "¿Qué te trae a Tempa?",
      "¿De qué te gusta hablar o escribir?"
    ],
    "placeholders": [
      "Amistad, otra perspectiva, un lugar donde escribir…",
      "Quizá días cotidianos, jardines, lugares o ideas inesperadas…"
    ],
    "fewWords": "Unas palabras más ayudarían.",
    "editable": "Puedes editarla cuando quieras.",
    "overLimit": "Reduce tu presentación a 600 caracteres.",
    "preview": "ASÍ LA VERÁN LOS DEMÁS",
    "placeholder": "Tus palabras aparecerán aquí.",
    "consent": "Tú decides si compartes. Solo una presentación aprobada será visible para otros miembros y servirá para recomendarte. Puedes ocultarla después. Nunca usamos tus cartas privadas.",
    "pending": "Tu presentación está pendiente de revisión. Nadie más la verá hasta su aprobación.",
    "visible": "Tu presentación es visible para los miembros de Tempa que cumplen los requisitos.",
    "hidden": "Tu presentación está oculta.",
    "submitted": "Has enviado tu presentación a revisión.",
    "saving": "Guardando…",
    "share": "Compartir mi presentación",
    "hide": "Ocultar presentación",
    "later": "Quizá más tarde",
    "submitError": "No se pudo enviar tu presentación. Vuelve a intentarlo.",
    "hideError": "No se pudo ocultar tu presentación.",
    "retry": "Inténtalo de nuevo."
  },
  "pt": {
    "back": "Voltar a Você",
    "eyebrow": "A SUA APRESENTAÇÃO PÚBLICA",
    "heading": "Um pouco sobre si, pelas suas palavras.",
    "lead": "Ainda não quer deixar uma carta? Uma breve apresentação pode ajudar alguém a querer conhecê-lo.",
    "prompts": [
      "O que o trouxe ao Tempa?",
      "Sobre o que gosta de falar ou escrever?"
    ],
    "placeholders": [
      "Uma amizade, uma nova perspetiva, um lugar para escrever…",
      "Talvez o quotidiano, jardins, lugares ou pensamentos inesperados…"
    ],
    "fewWords": "Mais algumas palavras ajudariam.",
    "editable": "Pode editar sempre que quiser.",
    "overLimit": "Reduza a apresentação para 600 caracteres.",
    "preview": "COMO OS OUTROS VÃO LER",
    "placeholder": "As suas palavras aparecerão aqui.",
    "consent": "A partilha é uma escolha sua. Só uma apresentação aprovada será visível para outros membros e usada nas recomendações. Pode ocultá-la mais tarde. As suas cartas privadas nunca são utilizadas.",
    "pending": "A sua apresentação aguarda revisão e continua invisível até ser aprovada.",
    "visible": "A sua apresentação é visível aos membros elegíveis de Tempa.",
    "hidden": "A sua apresentação está oculta.",
    "submitted": "A sua apresentação foi enviada para revisão.",
    "saving": "A guardar…",
    "share": "Partilhar a minha apresentação",
    "hide": "Ocultar apresentação",
    "later": "Talvez mais tarde",
    "submitError": "Não foi possível enviar a apresentação. Tente novamente.",
    "hideError": "Não foi possível ocultar a apresentação.",
    "retry": "Tente novamente."
  }
} as const

export const HOME_NUDGE_COPY = {
  "en": {
    "heading": "Let your words find someone, too.",
    "body": "A little of your day might help someone discover you.",
    "help": "Help me start a letter",
    "freely": "Write freely",
    "dismiss": "Dismiss the first-letter invitation"
  },
  "fr": {
    "heading": "Laissez aussi vos mots vous présenter.",
    "body": "Un moment de votre journée pourrait vous faire rencontrer quelqu’un.",
    "help": "Aidez-moi à commencer une lettre",
    "freely": "Écrire librement",
    "dismiss": "Masquer cette invitation"
  },
  "es": {
    "heading": "Deja que tus palabras te presenten.",
    "body": "Un poco de tu día podría ayudar a alguien a descubrirte.",
    "help": "Ayúdame a empezar una carta",
    "freely": "Escribir libremente",
    "dismiss": "Ocultar esta invitación"
  },
  "pt": {
    "heading": "Deixe que as suas palavras o apresentem.",
    "body": "Um pouco do seu dia pode ajudar alguém a descobri-lo.",
    "help": "Ajudem-me a começar uma carta",
    "freely": "Escrever livremente",
    "dismiss": "Ocultar este convite"
  }
} as const
