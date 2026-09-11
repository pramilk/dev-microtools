import { type ToolResult, ok, err, messageFrom } from './result';

/**
 * The built-in Mermaid themes exposed by this tool. Mermaid also supports a `'base'` theme
 * meant for further customisation via `themeVariables`, which this tool doesn't expose — the
 * five listed here are the ones a visitor can actually pick between and see a difference.
 */
export type MermaidTheme = 'default' | 'neutral' | 'dark' | 'forest' | 'base';

export interface MermaidThemeOption {
  id: MermaidTheme;
  label: string;
}

export const MERMAID_THEMES: readonly MermaidThemeOption[] = [
  { id: 'default', label: 'Default' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'dark', label: 'Dark' },
  { id: 'forest', label: 'Forest' },
  { id: 'base', label: 'Base (minimal)' },
];

export const DEFAULT_THEME: MermaidTheme = 'default';

/** The official syntax reference — linked from the UI so a visitor who outgrows the
 *  examples and snippets here has somewhere authoritative to go next. */
export const MERMAID_DOCS_URL = 'https://mermaid.js.org/intro/syntax-reference.html';

export interface MermaidSnippet {
  label: string;
  /** One-line tooltip explaining what this inserts. */
  description: string;
  /** Inserted verbatim at the cursor position. */
  insert: string;
}

export interface MermaidExample {
  id: string;
  label: string;
  /** One-line description shown as the picker option's tooltip. */
  description: string;
  /** The canonical opening keyword shown in the detected-type badge and in the "unrecognized
   *  keyword" hint — distinct from `detect`, which may also accept an older alias. */
  keyword: string;
  /** Matched against the first non-blank line of arbitrary source to detect which diagram
   *  type is being written, live, without waiting for a full parse — drives the type badge
   *  and the contextual snippet row. */
  detect: RegExp;
  code: string;
  /** A handful of common syntax fragments for this diagram type, inserted at the cursor by
   *  the "Snippets" row — a lightweight, dependency-free stand-in for full autocomplete. */
  snippets: readonly MermaidSnippet[];
}

/**
 * One example — and one small snippet set — per major Mermaid diagram type, so a first-time
 * visitor can see what the syntax looks like for the kind of diagram they actually want, and
 * keep building it with contextual snippets afterward rather than memorising the syntax.
 * `DEFAULT_EXAMPLE_ID` (flowchart) is also this tool's `.mdx` `example.input` — keep the two
 * in sync rather than letting them drift apart.
 */
export const MERMAID_EXAMPLES: readonly MermaidExample[] = [
  {
    id: 'architecture',
    label: 'Architecture Diagram',
    description: 'Cloud/infrastructure services, grouped and connected.',
    keyword: 'architecture-beta',
    detect: /^architecture(-beta)?\b/,
    code: `architecture-beta
    group api(cloud)[API]
    service db(database)[Database] in api
    service server(server)[Server] in api
    db:L -- R:server`,
    snippets: [
      { label: 'Service', description: 'A service node', insert: '    service svc(server)[Service]\n' },
      { label: 'Connection', description: 'Connects two services', insert: '    svcA:R -- L:svcB\n' },
    ],
  },
  {
    id: 'block',
    label: 'Block Diagram',
    description: 'Freeform labeled blocks laid out on a grid.',
    keyword: 'block-beta',
    detect: /^block(-beta)?\b/,
    code: `block-beta
    columns 3
    a["Block A"] b["Block B"] c["Block C"]
    a --> b
    b --> c`,
    snippets: [
      { label: 'Block', description: 'A labeled block', insert: '    x["Block"]\n' },
      { label: 'Columns', description: "Sets the grid's column count", insert: '    columns 3\n' },
    ],
  },
  {
    id: 'c4',
    label: 'C4 Diagram',
    description: "A software system's context, containers, or components.",
    keyword: 'C4Context',
    detect: /^C4(Context|Container|Component|Dynamic|Deployment)\b/,
    code: `C4Context
    title System Context
    Person(user, "User", "A user of the system")
    System(system, "System", "Does the thing")
    Rel(user, system, "Uses")`,
    snippets: [
      { label: 'Person', description: 'An actor outside the system', insert: '    Person(user, "User", "Description")\n' },
      { label: 'System', description: 'A system box', insert: '    System(sys, "System", "Description")\n' },
      { label: 'Relationship', description: 'A relationship between two elements', insert: '    Rel(user, sys, "Uses")\n' },
    ],
  },
  {
    id: 'class',
    label: 'Class Diagram',
    description: "A codebase's classes, their members, and inheritance.",
    keyword: 'classDiagram',
    detect: /^classDiagram\b/,
    code: `classDiagram
    class Animal {
      <<abstract>>
      #String name
      +int age
      +makeSound() void
    }
    class Dog {
      +fetch() void
    }
    class Cat {
      +scratch() void
    }
    class Pet {
      <<interface>>
      +play()
    }
    Animal <|-- Dog
    Animal <|-- Cat
    Dog ..|> Pet
    Animal "1" --> "0..*" Owner : belongs to
    class Owner {
      +String name
    }`,
    snippets: [
      { label: 'Class', description: 'A class with fields and a method', insert: '    class ClassName {\n      +field\n      +method()\n    }\n' },
      { label: 'Inheritance', description: 'Base <|-- Derived', insert: '    Base <|-- Derived\n' },
      { label: 'Composition', description: 'Whole *-- Part', insert: '    Whole *-- Part\n' },
      { label: 'Association', description: 'A --> B, optionally with a cardinality and label', insert: '    A "1" --> "0..*" B : label\n' },
      { label: 'Interface', description: 'Marks a class as an interface, implemented via ..|>', insert: '    <<interface>>\n' },
      { label: 'Abstract', description: 'Marks a class as abstract', insert: '    <<abstract>>\n' },
    ],
  },
  {
    id: 'cynefin',
    label: 'Cynefin Framework',
    description: 'The Clear/Complicated/Complex/Chaotic sense-making framework.',
    keyword: 'cynefin-beta',
    detect: /^cynefin(-beta)?\b/,
    code: `cynefin-beta
title Team decision framework

clear
"Fix a typo in the docs"

complicated
"Migrate the database engine"

complex
"Redesign the onboarding flow"

chaotic
"Production is down"

confusion
"Nobody owns this yet"

complex --> complicated : "Pattern identified"
clear --> chaotic : "Complacency"`,
    snippets: [
      { label: 'Title', description: 'Sets the diagram title', insert: 'title New title\n' },
      { label: 'Item', description: 'Adds a labeled item to the domain above it', insert: '"New item"\n' },
      {
        label: 'Transition',
        description: 'A labeled transition between two domains',
        insert: 'complex --> complicated : "label"\n',
      },
    ],
  },
  {
    id: 'er',
    label: 'Entity Relationship Diagram',
    description: "A database's tables, their fields, and how rows relate.",
    keyword: 'erDiagram',
    detect: /^erDiagram\b/,
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    ORDER }o--|| SHIPPING_ADDRESS : "ships to"
    CUSTOMER {
      string id PK
      string name
      string email UK
    }
    ORDER {
      int orderId PK
      date orderDate
      string customerId FK
    }
    LINE_ITEM {
      string product
      int quantity
    }`,
    snippets: [
      { label: 'Relationship', description: 'One-to-many relationship', insert: '    ENTITY_A ||--o{ ENTITY_B : relation\n' },
      { label: 'Attributes', description: "A table's fields", insert: '    ENTITY_A {\n      string name\n    }\n' },
      { label: 'Primary key', description: 'Marks a field as PK/FK/UK', insert: '      string id PK\n' },
    ],
  },
  {
    id: 'eventmodeling',
    label: 'Event Modeling',
    description: 'Commands, events and read models laid out as a timeline across swimlanes.',
    keyword: 'eventmodeling',
    detect: /^eventmodeling\b/,
    code: `eventmodeling
tf 01 ui CartUI
tf 02 cmd AddItem
tf 03 evt ItemAdded
tf 04 rmo CartSummary
tf 05 ui CartPage`,
    snippets: [
      { label: 'UI', description: 'A UI/trigger time frame', insert: 'tf 06 ui ScreenName\n' },
      { label: 'Command', description: 'A command time frame — a request to change state', insert: 'tf 07 cmd CommandName\n' },
      { label: 'Event', description: 'An event time frame — a record of what happened', insert: 'tf 08 evt EventName\n' },
      { label: 'Read model', description: 'A read model built from events', insert: 'tf 09 rmo ReadModelName\n' },
      { label: 'Processor', description: 'A processor time frame — reacts to an event with a new command', insert: 'tf 10 pcr ProcessorName\n' },
    ],
  },
  {
    id: 'flowchart',
    label: 'Flowchart',
    description: 'Boxes and arrows showing a process or decision tree.',
    keyword: 'flowchart',
    detect: /^(flowchart|graph)\b/,
    code: `flowchart TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Ship it]
    B -->|No| D[Debug]
    D --> B
    C --> E([Celebrate])
    subgraph Review
        F[(Database)] --> G{{Check logs}}
    end
    E --> F
    style C fill:#bbf7d0,stroke:#16a34a`,
    snippets: [
      { label: 'Node', description: 'A box with a label', insert: '    A[Label]\n' },
      { label: 'Arrow', description: 'A plain arrow between two nodes', insert: '    A --> B\n' },
      { label: 'Labelled arrow', description: 'An arrow with text on it', insert: '    A -->|label| B\n' },
      { label: 'Decision', description: 'A diamond-shaped decision node', insert: '    A --> B{Decision}\n' },
      { label: 'Subgraph', description: 'Groups nodes into a labeled box', insert: '    subgraph Group name\n      X --> Y\n    end\n' },
      { label: 'Style', description: "Overrides one node's fill and border colour", insert: '    style A fill:#bbf7d0,stroke:#16a34a\n' },
    ],
  },
  {
    id: 'gantt',
    label: 'Gantt Chart',
    description: 'A project schedule laid out against a timeline.',
    keyword: 'gantt',
    detect: /^gantt\b/,
    code: `gantt
    title Project Rollout
    dateFormat YYYY-MM-DD
    excludes weekends
    section Design
    Wireframes       :done,    des1, 2026-01-01, 5d
    Mockups          :active,  des2, after des1, 5d
    section Build
    Backend API      :         dev1, after des2, 10d
    Frontend         :         dev2, after des2, 10d
    section Launch
    QA               :         qa1, after dev1, 5d
    Release          :milestone, crit, rel1, after qa1, 0d`,
    snippets: [
      { label: 'Section', description: 'Groups tasks under a heading', insert: '    section Section name\n' },
      { label: 'Task', description: 'A task with an id and a duration', insert: '    Task name :task1, 2026-01-01, 5d\n' },
      { label: 'Dependent task', description: "Starts after another task ends", insert: '    Next task :task2, after task1, 3d\n' },
      { label: 'Milestone', description: 'A single point in time, zero duration', insert: '    Milestone :milestone, ms1, after task1, 0d\n' },
    ],
  },
  {
    id: 'gitgraph',
    label: 'Git Graph',
    description: 'Commits, branches, and merges in a repository.',
    keyword: 'gitGraph',
    detect: /^gitGraph\b/,
    code: `gitGraph
    commit
    commit
    branch feature
    checkout feature
    commit
    commit
    checkout main
    merge feature
    commit`,
    snippets: [
      { label: 'Commit', description: 'A commit on the current branch', insert: '    commit\n' },
      { label: 'Branch', description: 'Create and switch to a new branch', insert: '    branch feature\n    checkout feature\n' },
      { label: 'Merge', description: 'Merge a branch into the current one', insert: '    merge feature\n' },
    ],
  },
  {
    id: 'ishikawa',
    label: 'Ishikawa (Fishbone) Diagram',
    description: 'Root causes of a problem, grouped into categories.',
    keyword: 'ishikawa',
    detect: /^ishikawa(-beta)?\b/,
    code: `ishikawa
    title Root causes
    problem Late delivery
      People
        Understaffed
      Process
        No estimates`,
    snippets: [
      { label: 'Category', description: 'A cause category branch', insert: '      Category name\n' },
      { label: 'Cause', description: 'A specific cause under a category', insert: '        Specific cause\n' },
    ],
  },
  {
    id: 'kanban',
    label: 'Kanban Board',
    description: 'Cards grouped into columns, like Todo/Doing/Done.',
    keyword: 'kanban',
    detect: /^kanban\b/,
    code: `kanban
  Todo
    id1[Create Documentation]
  Doing
    id2[Update tests]
  Done
    id3[Ship it]`,
    snippets: [
      { label: 'Column', description: 'A new column heading', insert: '  Column name\n' },
      { label: 'Card', description: 'A card inside a column', insert: '    idN[Card text]\n' },
    ],
  },
  {
    id: 'mindmap',
    label: 'Mindmap',
    description: 'Ideas branching out from a central topic.',
    keyword: 'mindmap',
    detect: /^mindmap\b/,
    code: `mindmap
  root((Project Plan))
    Research
      Competitors
      User interviews
    Design
      Wireframes
      Prototypes
    )Development(
      Backend
      Frontend
    Launch
      Marketing
      Support`,
    snippets: [
      { label: 'Branch', description: 'A child topic, indentation shows nesting', insert: '    New topic\n' },
      { label: 'Cloud shape', description: 'A topic drawn as a cloud: )text(', insert: '    )New topic(\n' },
      { label: 'Circle shape', description: 'A topic drawn as a circle: ((text))', insert: '    ((New topic))\n' },
    ],
  },
  {
    id: 'packet',
    label: 'Packet Diagram',
    description: "A network packet's byte/bit layout, field by field.",
    keyword: 'packet',
    detect: /^packet(-beta)?\b/,
    code: `packet
0-15: "Source Port"
16-31: "Destination Port"
32-63: "Sequence Number"
64-95: "Acknowledgment Number"
96-99: "Data Offset"
100-105: "Reserved"
106-111: "Flags"
112-127: "Window"`,
    snippets: [{ label: 'Field', description: 'A bit-range field', insert: '0-7: "Field name"\n' }],
  },
  {
    id: 'pie',
    label: 'Pie Chart',
    description: 'Proportions of a whole, as labeled slices.',
    keyword: 'pie',
    detect: /^pie\b/,
    code: `pie title Browser market share
    "Chrome" : 65
    "Safari" : 18
    "Edge" : 8
    "Firefox" : 6
    "Other" : 3`,
    snippets: [{ label: 'Slice', description: 'A labeled slice and its value', insert: '    "Label" : 10\n' }],
  },
  {
    id: 'quadrant',
    label: 'Quadrant Chart',
    description: 'Points plotted on two axes, grouped into four quadrants.',
    keyword: 'quadrantChart',
    detect: /^quadrantChart\b/,
    code: `quadrantChart
    title Reach vs effort
    x-axis Low Effort --> High Effort
    y-axis Low Reach --> High Reach
    quadrant-1 Quick wins
    quadrant-2 Major projects
    quadrant-3 Fill-ins
    quadrant-4 Thankless tasks
    Campaign A: [0.3, 0.8]
    Campaign B: [0.7, 0.75]
    Campaign C: [0.2, 0.3]`,
    snippets: [
      { label: 'Point', description: 'A labeled point at [x, y], each 0-1', insert: '    Point name: [0.5, 0.5]\n' },
      { label: 'Quadrant label', description: 'Names one of the four quadrants', insert: '    quadrant-1 Label\n' },
    ],
  },
  {
    id: 'radar',
    label: 'Radar Chart',
    description: 'Values across several axes, plotted as a polygon.',
    keyword: 'radar-beta',
    detect: /^radar(-beta)?\b/,
    code: `radar-beta
    title Skills
    axis Speed, Power, Skill, Defense, Stamina
    curve A{80, 70, 90, 60, 85}`,
    snippets: [
      { label: 'Axis', description: 'Defines the radar axes', insert: '    axis A, B, C\n' },
      { label: 'Curve', description: 'A plotted data series', insert: '    curve Name{10, 20, 30}\n' },
    ],
  },
  {
    id: 'railroad-abnf',
    label: 'Railroad Diagram (ABNF)',
    description: 'An ABNF grammar rule, drawn as a syntax railroad diagram.',
    keyword: 'railroad-abnf-beta',
    detect: /^railroad-abnf(-beta)?\b/,
    code: `railroad-abnf-beta
rule = "a" "b";
greeting = rule "!" ;`,
    snippets: [{ label: 'Rule', description: 'A grammar rule', insert: 'rule2 = "c" "d";\n' }],
  },
  {
    id: 'railroad-ebnf',
    label: 'Railroad Diagram (EBNF)',
    description: 'An EBNF grammar rule, drawn as a syntax railroad diagram.',
    keyword: 'railroad-ebnf-beta',
    detect: /^railroad-ebnf(-beta)?\b/,
    code: `railroad-ebnf-beta
rule = "a", "b";
greeting = rule, "!";`,
    snippets: [{ label: 'Rule', description: 'A grammar rule', insert: 'rule2 = "c", "d";\n' }],
  },
  {
    id: 'railroad-peg',
    label: 'Railroad Diagram (PEG)',
    description: 'A PEG grammar rule, drawn as a syntax railroad diagram.',
    keyword: 'railroad-peg-beta',
    detect: /^railroad-peg(-beta)?\b/,
    code: `railroad-peg-beta
rule <- "a" "b";
greeting <- rule "!";`,
    snippets: [{ label: 'Rule', description: 'A grammar rule', insert: 'rule2 <- "c" "d";\n' }],
  },
  {
    id: 'requirement',
    label: 'Requirement Diagram',
    description: 'Formal requirements and how they relate to each other or to elements that satisfy them.',
    keyword: 'requirementDiagram',
    detect: /^requirementDiagram\b/,
    code: `requirementDiagram
    requirement login_required {
    id: 1
    text: users must authenticate
    risk: high
    verifymethod: test
    }
    element login_form {
    type: interface
    }
    login_form - satisfies -> login_required`,
    snippets: [
      {
        label: 'Requirement',
        description: 'A formal requirement block',
        insert: '    requirement req_name {\n    id: 1\n    text: description\n    risk: medium\n    verifymethod: test\n    }\n',
      },
      { label: 'Satisfies', description: 'Links an element to a requirement it satisfies', insert: '    element_name - satisfies -> req_name\n' },
    ],
  },
  {
    id: 'sankey',
    label: 'Sankey Diagram',
    description: 'Flow quantities between stages, sized by volume.',
    keyword: 'sankey-beta',
    detect: /^sankey(-beta)?\b/,
    code: `sankey-beta

Salary,Income,4000
Freelance,Income,800
Income,Rent,1600
Income,Groceries,500
Income,Utilities,200
Income,Transport,250
Income,Entertainment,250
Income,Savings,2000`,
    snippets: [{ label: 'Flow', description: 'A source,target,value row — repeat a source or target to converge or diverge flows', insert: 'Source,Target,10\n' }],
  },
  {
    id: 'sequence',
    label: 'Sequence Diagram',
    description: 'Messages exchanged between participants over time.',
    keyword: 'sequenceDiagram',
    detect: /^sequenceDiagram\b/,
    code: `sequenceDiagram
    participant Browser
    participant API
    participant DB
    Browser->>+API: POST /login
    API->>+DB: Verify credentials
    DB-->>-API: User record
    alt credentials valid
        API-->>Browser: 200 OK + session token
    else invalid
        API-->>Browser: 401 Unauthorized
    end
    deactivate API
    Note right of Browser: Token stored in memory
    loop Every 5 minutes
        Browser->>API: Refresh token
    end`,
    snippets: [
      { label: 'Participant', description: 'Declares a named participant', insert: '    participant A\n' },
      { label: 'Message', description: 'A solid-line message', insert: '    A->>B: message\n' },
      { label: 'Reply', description: 'A dashed-line reply', insert: '    B-->>A: reply\n' },
      { label: 'Note', description: 'A note attached to a participant', insert: '    Note right of A: note text\n' },
      { label: 'Loop', description: 'A repeating block', insert: '    loop Every day\n        A->>B: ping\n    end\n' },
      { label: 'Alt', description: 'Branches on a condition, with an optional else', insert: '    alt condition\n        A->>B: yes path\n    else\n        A->>B: no path\n    end\n' },
      { label: 'Activate', description: "Marks a participant's active lifeline (+ / -)", insert: '    A->>+B: message\n    B-->>-A: reply\n' },
    ],
  },
  {
    id: 'state',
    label: 'State Diagram',
    description: 'The states a system can be in, and what triggers each transition.',
    keyword: 'stateDiagram-v2',
    detect: /^stateDiagram(-v2)?\b/,
    code: `stateDiagram-v2
    [*] --> Idle
    Idle --> Loading: fetch()
    state Loading {
        [*] --> Requesting
        Requesting --> Waiting
        Waiting --> [*]
    }
    Loading --> Success: 200 OK
    Loading --> Error: request failed
    state success_check <<choice>>
    Success --> success_check
    success_check --> Idle: reset()
    success_check --> [*]: done
    Error --> Idle: retry()`,
    snippets: [
      { label: 'Start', description: 'Initial-state transition', insert: '    [*] --> StateA\n' },
      { label: 'Transition', description: 'A transition with a trigger label', insert: '    StateA --> StateB: event\n' },
      { label: 'End', description: 'Final-state transition', insert: '    StateA --> [*]\n' },
      { label: 'Composite state', description: 'A state containing its own nested states', insert: '    state Outer {\n        [*] --> Inner\n        Inner --> [*]\n    }\n' },
      { label: 'Choice', description: 'A branch point with more than one outgoing condition', insert: '    state choice1 <<choice>>\n    StateA --> choice1\n' },
    ],
  },
  {
    id: 'swimlane',
    label: 'Swimlane Diagram',
    description: 'A flowchart grouped into lanes, one per actor or team.',
    keyword: 'swimlane-beta',
    detect: /^swimlane(-beta)?\b/,
    code: `swimlane-beta
    subgraph Customer
      A[Place order] --> B[Pay]
    end
    subgraph Warehouse
      C[Pack order] --> D[Ship]
    end
    B --> C`,
    snippets: [
      { label: 'Lane', description: 'A grouped lane of steps', insert: '    subgraph Lane name\n      X[Step]\n    end\n' },
      { label: 'Arrow', description: 'A step arrow', insert: '    A --> B\n' },
    ],
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'Events plotted along a single chronological line.',
    keyword: 'timeline',
    detect: /^timeline\b/,
    code: `timeline
    title Company milestones
    2022 : Founded
         : First customer
    2023 : Seed funding
         : 10 employees
    2024 : Series A
    2025 : International launch`,
    snippets: [
      { label: 'Period + event', description: 'A time period and its first event', insert: '    2026 : Event\n' },
      { label: 'Extra event', description: 'Another event in the same period', insert: '         : Another event\n' },
      { label: 'Section', description: 'Groups periods under a heading', insert: '    section Section name\n' },
    ],
  },
  {
    id: 'treemap',
    label: 'Treemap',
    description: 'Nested categories sized by value, as proportioned tiles.',
    keyword: 'treemap',
    detect: /^treemap(-beta)?\b/,
    code: `treemap
"Category A"
    "Item 1": 10
    "Item 2": 20
"Category B"
    "Item 3": 15
    "Item 4": 25
"Category C"
    "Item 5": 5`,
    snippets: [{ label: 'Item', description: 'A leaf value', insert: '    "Item": 10\n' }],
  },
  {
    id: 'treeview',
    label: 'TreeView',
    description: 'A file/folder hierarchy, drawn as an indented directory tree.',
    keyword: 'treeView-beta',
    detect: /^treeView(-beta)?\b/,
    code: `treeView-beta
    my-project/
        src/
            index.js
            utils.js
        package.json
        README.md`,
    snippets: [
      { label: 'Directory', description: "A folder — a trailing '/' renders it in bold", insert: '        folder/\n' },
      { label: 'File', description: 'A leaf file', insert: '        file.js\n' },
      { label: 'Description', description: 'An inline italic description after a node', insert: '        file.js ## description\n' },
      { label: 'Highlight', description: "Applies the built-in 'highlight' CSS class to a node", insert: '        file.js :::highlight\n' },
    ],
  },
  {
    id: 'journey',
    label: 'User Journey',
    description: 'The steps a user takes, each scored for how it feels.',
    keyword: 'journey',
    detect: /^journey\b/,
    code: `journey
    title Signing up for an account
    section Discover
      Land on homepage: 5: Visitor
      Read pricing: 3: Visitor
    section Sign up
      Fill in form: 3: Visitor
      Verify email: 2: Visitor
    section First use
      Complete onboarding: 4: Visitor, System`,
    snippets: [
      { label: 'Section', description: 'Groups steps under a heading', insert: '    section Section name\n' },
      { label: 'Step', description: 'A step, its score out of 5, and who does it', insert: '      Step name: 3: Actor\n' },
    ],
  },
  {
    id: 'venn',
    label: 'Venn Diagram',
    description: 'Overlapping sets, sized by how much they overlap.',
    keyword: 'venn-beta',
    detect: /^venn(-beta)?\b/,
    code: `venn-beta
    set A: 12
    set B: 10
    set C: 8
    union A,B: 4
    union A,C: 3
    union B,C: 2
    union A,B,C: 1`,
    snippets: [
      { label: 'Set', description: 'A labeled set with its size', insert: '    set D: 5\n' },
      { label: 'Overlap', description: 'The overlap between two (or more) sets', insert: '    union A,C: 2\n' },
    ],
  },
  {
    id: 'wardley',
    label: 'Wardley Map',
    description: 'Components plotted by visibility and evolution.',
    keyword: 'wardley-beta',
    detect: /^wardley(-beta)?\b/,
    code: `wardley-beta
    title Map
    component User [0.9, 0.1]
    component Product [0.5, 0.5]
    User -> Product`,
    snippets: [
      { label: 'Component', description: 'A mapped component at [visibility, evolution]', insert: '    component Name [0.5, 0.5]\n' },
      { label: 'Dependency', description: 'A dependency link', insert: '    A -> B\n' },
    ],
  },
  {
    id: 'xychart',
    label: 'XY Chart',
    description: 'A bar and/or line chart plotted against numeric axes.',
    keyword: 'xychart-beta',
    detect: /^xychart(-beta)?\b/,
    code: `xychart-beta
    title "Sales"
    x-axis [jan, feb, mar, apr]
    y-axis "Revenue" 0 --> 1000
    bar [500, 620, 450, 700]
    line [500, 620, 450, 700]`,
    snippets: [
      { label: 'Bar series', description: 'A bar series of values', insert: '    bar [10, 20, 30]\n' },
      { label: 'Line series', description: 'A line series of values', insert: '    line [10, 20, 30]\n' },
    ],
  },
];

export const DEFAULT_EXAMPLE_ID = 'flowchart';

export function exampleById(id: string): MermaidExample | undefined {
  return MERMAID_EXAMPLES.find((example) => example.id === id);
}

/**
 * Detects which diagram type is being written from the first non-blank line of arbitrary
 * source — live, without waiting for a full (and possibly still-incomplete) parse. Drives
 * the "detected type" badge and which snippet row is shown; returns `null` for an empty
 * source or a first line that doesn't match any known diagram-type keyword, which the UI
 * treats as a hint that the source needs to start with one of them.
 */
export function detectDiagramTypeId(source: string): string | null {
  const firstLine = source
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (firstLine === undefined) return null;
  return MERMAID_EXAMPLES.find((example) => example.detect.test(firstLine))?.id ?? null;
}

/** The canonical starting keyword for every supported diagram type, in the same order as
 *  `MERMAID_EXAMPLES` — shown as a hint when a diagram's first line isn't recognized. */
export const DIAGRAM_KEYWORDS: readonly string[] = MERMAID_EXAMPLES.map((example) => example.keyword);

/**
 * Diagrams render synchronously on the main thread with no way to show progress (no worker
 * offload — Mermaid's layout engine isn't worker-safe). Beyond this size a single keystroke
 * can noticeably stall the tab, and nothing realistically hand-written needs more.
 */
export const MAX_INPUT_LENGTH = 50_000;

export function validateMermaidSource(input: string): ToolResult<string> {
  if (input.trim() === '') {
    return err('Enter Mermaid diagram syntax to render, or load an example.');
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to render in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }
  return ok(input);
}

let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;

/**
 * Loaded lazily so Mermaid (which pulls in d3 and dagre for layout) is fetched only when
 * someone actually opens this tool, never on page load and never for any other tool on the
 * site. Cached at module scope so re-rendering on every keystroke doesn't re-fetch it; a
 * failed load clears the cache so a retry actually retries instead of permanently caching
 * a rejected promise.
 */
function loadMermaid(): Promise<typeof import('mermaid')> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').catch((error: unknown) => {
      mermaidModulePromise = null;
      throw error;
    });
  }
  return mermaidModulePromise;
}

let renderCount = 0;

export interface RenderMermaidOptions {
  theme: MermaidTheme;
}

/**
 * Renders Mermaid syntax to an SVG string.
 *
 * `securityLevel: 'strict'` is set explicitly (it's also Mermaid's own default) and is not
 * exposed as a configurable option: it sanitizes node/edge labels and disables script and
 * click-callback injection, which matters here because diagram text can arrive from a
 * shared link written by someone else, not just typed by the current visitor — the same
 * reasoning Markdown Previewer's sandboxed preview frame documents.
 */
export async function renderMermaidDiagram(input: string, options: RenderMermaidOptions): Promise<ToolResult<string>> {
  const validated = validateMermaidSource(input);
  if (!validated.ok) return validated;

  let mermaidModule: typeof import('mermaid');
  try {
    mermaidModule = await loadMermaid();
  } catch (error) {
    return err(messageFrom(error, 'Could not load the diagram renderer — check your connection and try again.'));
  }

  try {
    const mermaid = mermaidModule.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: options.theme,
      fontFamily:
        'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
    });
    renderCount += 1;
    const { svg } = await mermaid.render(`mermaid-diagram-${renderCount}`, input);
    return ok(svg);
  } catch (error) {
    // Mermaid's own parse errors are already specific (they name the offending line and
    // what was expected there), so they're surfaced directly rather than replaced with a
    // generic message — same reasoning as JSON Formatter surfacing the parser's own error.
    // The UI adds one more layer on top: when the first line doesn't match any known
    // diagram-type keyword at all, it also lists the valid keywords (see DIAGRAM_KEYWORDS),
    // which is usually the actual mistake behind a totally blank/unparsed diagram.
    return err(messageFrom(error, 'Could not render this diagram — check the syntax.'));
  }
}

/**
 * Reads a rendered SVG string's intrinsic pixel size from its `viewBox`/`width`/`height`
 * attributes, for building a PNG export at a target resolution. Falls back to a reasonable
 * default when neither is present, which shouldn't happen for Mermaid's own output but keeps
 * this from ever dividing by zero.
 */
export function svgIntrinsicSize(svgMarkup: string): { width: number; height: number } {
  const viewBoxMatch = /viewBox="[^"]*?\s([\d.]+)\s+([\d.]+)"/.exec(svgMarkup);
  if (viewBoxMatch) {
    const width = Number.parseFloat(viewBoxMatch[1]!);
    const height = Number.parseFloat(viewBoxMatch[2]!);
    if (width > 0 && height > 0) return { width, height };
  }

  const widthMatch = /\bwidth="([\d.]+)/.exec(svgMarkup);
  const heightMatch = /\bheight="([\d.]+)/.exec(svgMarkup);
  const width = widthMatch ? Number.parseFloat(widthMatch[1]!) : 0;
  const height = heightMatch ? Number.parseFloat(heightMatch[1]!) : 0;
  if (width > 0 && height > 0) return { width, height };

  return { width: 800, height: 600 };
}
