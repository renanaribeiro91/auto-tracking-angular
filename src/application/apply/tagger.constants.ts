/** Vocabulário usado para distinguir a intenção de avanço e retorno. */
export const FORWARD_ACTION = /\b(avanc|proxim|continu|seguir|next|forward)/;
export const BACKWARD_ACTION = /\b(voltar|anterior|retornar|back|previous)/;

/** Palavras de código (prefixos de teste, verbos de evento) que não descrevem a ação no rótulo. */
export const TECHNICAL_LABEL_WORDS: ReadonlySet<string> = new Set([
  'btn', 'button', 'icon', 'ico', 'img', 'lnk', 'lbl', 'txt', 'chk', 'inp', 'testid', 'test', 'e2e',
  'on', 'ao', 'handle', 'handler', 'action', 'acao', 'click', 'clicked', 'cliked', 'clique', 'clicar', 'evt', 'event', 'emit', 'fn', 'cb',
]);

/** Mesmo vocabulário do runtime: a planilha e o envio limpam igual. */
export { UI_STRUCTURE_WORDS, ENGLISH_ACTIONS as ACTION_VERBS } from '../../domain/contract/slug.js';

/**
 * Expressão de rótulo dinâmico com indício de dado pessoal ou variável de negócio:
 * o texto visível não é enviado e o rótulo semântico da ação é usado.
 */
export const PERSONAL_DATA_EXPRESSION = /(?:^|-)(?:nome|name|cpf|cnpj|rg|email|mail|telefone|celular|phone|fone|endereco|address|logradouro|cep|bairro|cidade|cartao|carteirinha|numero|number|matricula|beneficiario|titular|dependente|usuario|user|paciente|segurado|senha|password|token|protocolo|nascimento|idade|valor|saldo|preco|data|date|documento|placa|conta|agencia)(?:-|$)/;

/** Dado que identifica alguém, é digitado/enviado pela pessoa ou é uma medida (distância, total): nunca vira rótulo. */
export const PERSONAL_FIELD_WORDS: ReadonlySet<string> = new Set(['cpf', 'cnpj', 'rg', 'email', 'mail', 'telefone', 'celular', 'phone', 'fone',
  'endereco', 'address', 'logradouro', 'cep', 'bairro', 'cidade', 'cartao', 'carteirinha', 'numero', 'number', 'matricula', 'senha', 'password',
  'token', 'protocolo', 'nascimento', 'idade', 'valor', 'saldo', 'preco', 'data', 'date', 'documento', 'placa', 'conta', 'agencia',
  'arquivo', 'file', 'anexo', 'foto', 'imagem', 'mensagem', 'comentario', 'observacao', 'apelido',
  'distancia', 'quantidade', 'qtd', 'total', 'percentual', 'contador', 'count']);
/** Entidade pessoa: o nome dela ou um campo dela sem significado de catálogo é dado pessoal. */
export const PERSON_WORDS: ReadonlySet<string> = new Set(['beneficiario', 'titular', 'dependente', 'usuario', 'user', 'paciente', 'segurado',
  'cliente', 'pessoa', 'mae', 'pai', 'conjuge', 'responsavel', 'contato', 'medico', 'profissional', 'prestador', 'social', 'completo', 'profile', 'perfil']);
/** Campo que só uma pessoa tem: o tipo que o declara é de pessoa, e o nome dele é dado pessoal. */
export const PERSON_IDENTIFIER_WORDS: ReadonlySet<string> = new Set(['cpf', 'rg', 'nascimento', 'email', 'telefone', 'celular', 'matricula', 'carteirinha', 'sexo', 'genero']);
/** Verbo de escolha de valor: o item escolhido vai na opção e o rótulo é a ação. */
export const CHOICE_VERBS: ReadonlySet<string> = new Set(['selecionar', 'seleciona', 'select', 'escolher', 'escolhe', 'choose', 'marcar', 'marca',
  'filtrar', 'filtra', 'filter', 'definir', 'set']);
/** Palavra que torna o resto do campo uma classificação (`tipoDocumento`, `statusConta`): o valor é do catálogo, não da pessoa. */
export const CLASSIFIER_WORDS: ReadonlySet<string> = new Set(['tipo', 'type', 'categoria', 'category', 'especie', 'modalidade', 'classe', 'status', 'situacao']);

/** Output de navegação do próprio componente (voltar/fechar do header/modal). */
export const COMPONENT_NAVIGATION_OUTPUT = /(?:^|-)(?:back|voltar|retornar|close|fechar|dismiss|cancel|cancelar)(?:-|$)/;

/** Valor de atributo com forma de identificador (data-testid, id de teste), não de texto exibido. */
export const looksLikeIdentifier = (value: string): boolean => {
  const text = value.trim();
  if (/\s/.test(text)) return false;
  return /[_.]|[a-z][A-Z]/.test(text) || /^(?:btn|button|icon|ico|img|lnk|link|lbl|txt|input|inp|list|chk|test|e2e)[-_]/i.test(text)
    || (text.match(/-/g)?.length ?? 0) >= 2;
};

/** Gestos DOM aceitos como interação observável. */
export const DOM_GESTURES = ['(click)', '(ionChange)', '(change)', '(ngSubmit)', '(submit)'] as const;

/** Mesma exclusão na instrumentação e na prova de cobertura do componente filho. */
export const isInputField = (tag: string): boolean => {
  const name = tag.toLowerCase();
  if (/^(?:input|textarea)$/.test(name)) return true;
  // Ionic é um componente de plataforma; prefixos de design systems são livres.
  if (/^ion-(?:input(?:-otp)?|textarea|searchbar)$/.test(name)) return true;
  // Reconhece campo com prefixo único de biblioteca sem confundir componentes
  // compostos, por exemplo <ui-card-input-document>, com inputs de digitação.
  const parts = name.split('-');
  const localName = parts.length > 1 ? parts.slice(1).join('-') : name;
  return /^(?:(?:form-)?(?:input|textarea|searchbar|text-field|text-input))(?:-|$)/.test(localName);
};

/** Eventos técnicos que não representam ação de negócio. */
export const TECHNICAL_EVENT = /(blur|focus|input|keyup|keydown|keypress|paste|copy|cut|drop|scroll|refresh|infinite|dismiss|didenter|willenter|didleave|willleave|load|error|swipe|touch|drag|hover|mouse|contextmenu|outputform|valuechange|ngmodelchange|animation|transition|resize|init|destroy|ready|ionselect|formchange|formvalid|onvalid|onmonthchange|(?:opened|closed)modal)/i;

/** Componentes Ionic que agem sozinhos ao toque, sem handler no template, e o nome da ação quando não há texto. */
export const IONIC_OWN_ACTION: Readonly<Record<string, string>> = {
  'ion-back-button': 'voltar', 'ion-menu-button': 'abrir-menu', 'ion-menu-toggle': 'abrir-menu',
};

/** Controles cujo evento de mudança deve ser tratado como seleção. */
export const CHANGE_CONTROL_TAGS: ReadonlySet<string> = new Set([
  'ion-select', 'select', 'ion-checkbox', 'ion-toggle', 'ion-radio-group', 'ion-segment', 'ion-range', 'ion-datetime',
]);

/** Atributos/inputs cujo valor é o texto exibido do controle, em ordem de prioridade (exato: `headerTexto` descreve outro conteúdo). */
export const LABEL_ATTRIBUTES = ['aria-label', 'label', 'title', 'texto', 'text', 'titulo', 'rotulo'] as const;
/** Input composto que nomeia o controle (`tabTitle`, `buttonLabel`); só vale com gesto único; cabeçalho, subtítulo, botões internos (`okText`) e valor escolhido (`selectedText`, `placeholderText`) descrevem outro conteúdo. */
export const COMPOUND_LABEL_INPUT = /^(?!header|cabecalho|sub|ok|cancel|confirm|done|close|clear|err|help|ajuda|selected|selecionad|value|valor|placeholder|search|busca|empty|vazio|hint)[a-z]\w*(?:Title|Titulo|Label|Text|Texto)$/;
/** Os mesmos atributos na forma ligada (`[attr.x]`/`[x]`). */
export const BOUND_LABEL_ATTRIBUTES: readonly string[] = LABEL_ATTRIBUTES.flatMap((name) => [`[attr.${name}]`, `[${name}]`]);

/** Nome que só repete o tipo do controle (`clickLink` → `link`) não descreve a ação. */
/** Verbos que só dizem algo com o objeto: sozinhos (`mostraModal` sem o `modal`) não nomeiam a ação. */
export const OBJECT_VERBS: ReadonlySet<string> = new Set(['abrir', 'abre', 'mostrar', 'mostra', 'exibir', 'exibe', 'ver', 'visualizar', 'apresentar']);

export const GENERIC_ELEMENT_LABEL = /^(?:link|botao|button|item|card|elemento|opcao|option|acao|action|lista|list)$/;

/** Controles cujo conteúdo são as opções (o valor escolhido), nunca o nome do controle. */
export const OPTION_CONTAINER_TAGS: ReadonlySet<string> = new Set(['select', 'ion-select', 'ion-radio-group', 'ion-segment']);

/** Overlays declarados no template e o tipo enviado em `elemento` na `visualizacao` (o mesmo vocabulário do runtime). */
export const INLINE_OVERLAY_KIND: Readonly<Record<string, string>> = {
  'ion-modal': 'modal', 'ion-popover': 'popover', 'ion-alert': 'alerta', 'ion-action-sheet': 'menu-de-opcoes',
};
/** Palavras de estado/código no gatilho de um overlay inline (`isModalAjudaOpen` → `ajuda`). */
export const OVERLAY_NAME_NOISE: ReadonlySet<string> = new Set([
  'is', 'open', 'opened', 'aberto', 'aberta', 'abrir', 'exibir', 'mostrar', 'show', 'visible', 'visivel', 'modal', 'popover',
  'alert', 'alerta', 'sheet', 'action', 'trigger', 'btn', 'button', 'botao', 'id', 'this',
]);
