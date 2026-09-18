import type { LearningMode, Topic } from '@/types/domain';

/**
 * Built-in learning modes. Topics act as navigation + filters; they do not
 * pretend to be a curriculum. Keywords feed the rules classifier
 * (src/learning/relevance):
 *
 * - multi-word phrases ("dynamic programming") are the strongest signals
 * - specific single words ("backpropagation", "pytorch") are strong
 * - broad words ("ai", "data", "algorithm") only support other evidence
 * - "~keyword" marks a supporting signal explicitly ("~probability"): it adds
 *   confidence but never qualifies a video on its own
 */

const t = (id: string, name: string, keywords: string[] = []): Topic => ({ id, name, keywords });

const COMMON_BLOCKED = ['prank'];

type Template = Omit<LearningMode, 'createdAt' | 'updatedAt'>;

const base = (m: Pick<Template, 'id' | 'name' | 'emoji' | 'icon' | 'description' | 'topics' | 'keywords' | 'searchHint'> & Partial<Template>): LearningMode => ({
  kind: 'learning',
  discovery: true,
  blockedKeywords: COMMON_BLOCKED,
  allowedChannels: [],
  blockedChannels: [],
  dailyLimitMinutes: 90,
  filterOverride: null,
  createdAt: 0,
  updatedAt: 0,
  ...m,
});

export const DEFAULT_MODES: LearningMode[] = [
  base({
    id: 'dsa',
    name: 'DSA',
    emoji: '🧠',
    icon: 'brain',
    description: 'Data structures, algorithms and interview problem solving.',
    searchHint: 'data structures and algorithms',
    keywords: [
      'dsa',
      'data structure',
      'data structures',
      'algorithm',
      'leetcode',
      'codeforces',
      'codechef',
      'competitive programming',
      'coding interview',
      'time complexity',
      'space complexity',
      'big o notation',
      'geeksforgeeks',
      '~problem solving',
    ],
    topics: [
      t('arrays', 'Arrays', ['array', 'two pointer', 'two pointers', 'sliding window', 'prefix sum', 'kadane', 'subarray']),
      t('strings', 'Strings', ['string', 'substring', 'palindrome', 'anagram', 'kmp algorithm', 'rabin karp', 'string matching', 'longest common prefix']),
      t('linked-lists', 'Linked Lists', ['linked list', 'doubly linked list', 'singly linked list', 'cycle detection']),
      t('stacks-queues', 'Stacks & Queues', ['stack', 'queue', 'deque', 'monotonic stack', 'next greater element', 'stack and queue']),
      t('recursion', 'Recursion', ['recursion', 'recursive', 'recursion tree', 'base case']),
      t('binary-trees', 'Binary Trees', ['binary tree', 'tree traversal', 'inorder traversal', 'preorder traversal', 'level order traversal', 'lowest common ancestor', '~trees']),
      t('bst', 'BST', ['binary search tree', 'bst', 'avl tree', 'red black tree']),
      t('heaps', 'Heaps', ['heap', 'priority queue', 'heapify', 'min heap', 'max heap']),
      t('hashing', 'Hashing', ['hashing', 'hash map', 'hashmap', 'hash table', 'hashset', 'hash function']),
      t('graphs', 'Graphs', ['graph', 'bfs', 'dfs', 'breadth first search', 'depth first search', 'dijkstra', 'topological sort', 'union find', 'disjoint set', 'minimum spanning tree', 'shortest path', 'graph theory', 'bellman ford', 'floyd warshall']),
      t('greedy', 'Greedy', ['greedy algorithm', 'greedy approach', 'activity selection', 'huffman coding', 'interval scheduling']),
      t('dynamic-programming', 'Dynamic Programming', ['dp', 'memoization', 'tabulation', 'knapsack', 'longest common subsequence', 'longest increasing subsequence', 'coin change', 'edit distance', 'matrix chain multiplication']),
      t('backtracking', 'Backtracking', ['backtracking', 'n queens', 'sudoku solver', 'combination sum', 'hamiltonian cycle', '~permutations']),
      t('sorting', 'Sorting', ['merge sort', 'quick sort', 'quicksort', 'bubble sort', 'insertion sort', 'selection sort', 'counting sort', 'radix sort', 'heap sort', 'sorting algorithm', '~sorting']),
      t('searching', 'Searching', ['binary search', 'linear search', 'lower bound', 'upper bound', '~searching']),
    ],
  }),
  base({
    id: 'web-dev',
    name: 'Web Development',
    emoji: '💻',
    icon: 'code',
    description: 'Frontend, backend and everything in between.',
    searchHint: 'web development',
    keywords: ['web development', 'web dev', 'frontend', 'front end', 'backend', 'back end', 'full stack', 'fullstack', 'web app', '~website'],
    topics: [
      t('html-css', 'HTML & CSS', ['html', 'css', 'flexbox', 'css grid', 'responsive design', 'tailwind', 'tailwind css']),
      t('javascript', 'JavaScript', ['javascript', 'js', 'es6', 'async await', 'event loop', 'closures', '~dom', '~promises']),
      t('typescript', 'TypeScript', ['typescript']),
      t('react', 'React', ['react', 'reactjs', 'react js', 'react hooks', 'jsx', 'redux', 'usestate', 'useeffect', '~hooks']),
      t('nextjs', 'Next.js', ['next.js', 'nextjs', 'next js', 'server components', 'app router']),
      t('node', 'Node.js', ['node.js', 'nodejs', 'node js', 'express.js', 'expressjs', '~express']),
      t('apis', 'APIs & REST', ['rest api', 'restful', 'graphql', 'jwt', '~http', '~authentication']),
      t('databases', 'Databases', ['mongodb', 'postgresql', 'postgres', 'mysql', 'prisma', '~sql']),
      t('git', 'Git & GitHub', ['git', 'github', 'version control']),
      t('deployment', 'Deployment', ['docker', 'vercel', 'ci/cd', 'nginx', '~deployment', '~hosting']),
    ],
  }),
  base({
    id: 'ai-ml',
    name: 'AI / ML',
    emoji: '🤖',
    icon: 'bot',
    description: 'Machine learning, deep learning and modern AI systems.',
    searchHint: 'machine learning',
    keywords: ['machine learning', 'deep learning', 'artificial intelligence', 'ai', 'ml', 'large language model', 'large language models', 'model training', 'neural net', 'generative ai', 'ai engineering', '~data science'],
    topics: [
      t('ml-math', 'Math for ML', ['linear algebra', 'gradient descent', 'loss function', '~probability', '~statistics', '~calculus', '~matrix', '~gradient', '~optimization']),
      t('ml-foundations', 'ML Foundations', ['linear regression', 'logistic regression', 'regression', 'supervised learning', 'unsupervised learning', 'decision tree', 'random forest', 'svm', 'support vector machine', 'scikit-learn', 'sklearn', 'xgboost', 'k-means', 'clustering', 'overfitting', 'cross validation', '~classification']),
      t('deep-learning', 'Deep Learning', ['neural network', 'backpropagation', 'backprop', 'pytorch', 'tensorflow', 'keras', 'cnn', 'convolutional neural network', 'rnn', 'lstm', 'batchnorm', 'activation function']),
      t('nlp', 'NLP', ['nlp', 'natural language processing', 'tokenization', 'tokenizer', 'embeddings', 'word2vec', 'language model', 'language modeling', 'bert']),
      t('computer-vision', 'Computer Vision', ['computer vision', 'image classification', 'object detection', 'image segmentation', 'opencv', 'yolo', 'diffusion model', 'vlm']),
      t('llms', 'LLMs & Transformers', ['llm', 'llms', 'transformer', 'attention mechanism', 'self-attention', 'gpt', 'fine tuning', 'fine-tuning', 'lora', 'qlora', 'rag', 'retrieval augmented generation', 'prompt engineering', 'rlhf']),
      t('ai-engineering', 'AI Engineering & Agents', ['ai agent', 'ai agents', 'agentic', 'mcp server', 'langchain', 'langgraph', 'llamaindex', 'vector database', 'function calling', 'tool calling', 'llm gateway']),
      t('rl', 'Reinforcement Learning', ['reinforcement learning', 'q learning', 'q-learning', 'policy gradient', 'ppo']),
      t('mlops', 'MLOps', ['mlops', 'model deployment', 'model serving', 'mlflow', '~inference']),
    ],
  }),
  base({
    id: 'data-science',
    name: 'Data Science',
    emoji: '📊',
    icon: 'bar-chart',
    description: 'Analysis, visualisation and statistics with real data.',
    searchHint: 'data science',
    keywords: ['data science', 'data scientist', 'data analysis', 'data analyst', '~analytics'],
    topics: [
      t('python-ds', 'Python for Data', ['jupyter', 'jupyter notebook', 'python for data science', '~python']),
      t('pandas', 'Pandas', ['pandas', 'dataframe']),
      t('numpy', 'NumPy', ['numpy', '~arrays']),
      t('viz', 'Visualization', ['data visualization', 'matplotlib', 'seaborn', 'plotly', 'tableau', 'power bi', '~dashboard', '~visualization']),
      t('stats', 'Statistics', ['hypothesis testing', 'probability distribution', 'a/b testing', 'p-value', '~statistics', '~probability', '~regression']),
      t('eda', 'EDA', ['exploratory data analysis', 'eda', 'data cleaning', 'feature engineering']),
      t('sql-analysis', 'SQL for Analysis', ['sql for data analysis', '~sql', '~queries']),
    ],
  }),
  base({
    id: 'sql',
    name: 'SQL',
    emoji: '🗄️',
    icon: 'database',
    description: 'Relational databases and querying.',
    searchHint: 'sql',
    keywords: ['sql', 'dbms', 'rdbms', 'postgresql', 'postgres', 'mysql', 'sqlite', 'sql server', '~database'],
    topics: [
      t('sql-basics', 'Basics & SELECT', ['select statement', 'where clause', 'sql basics', 'sql tutorial', '~select']),
      t('joins', 'Joins', ['sql joins', 'inner join', 'left join', 'right join', 'outer join', 'self join', '~joins']),
      t('aggregation', 'Aggregation', ['group by', 'aggregate functions', 'having clause', '~count', '~sum']),
      t('subqueries', 'Subqueries & CTEs', ['subquery', 'subqueries', 'cte', 'common table expression']),
      t('window-functions', 'Window Functions', ['window function', 'partition by', 'row_number', '~rank']),
      t('indexes', 'Indexes & Performance', ['indexing', 'query optimization', 'explain plan', '~index']),
      t('design', 'Schema Design', ['normalization', 'normal form', 'er diagram', 'schema design', 'primary key', 'foreign key']),
      t('transactions', 'Transactions', ['acid properties', 'isolation level', 'deadlock', '~transaction']),
    ],
  }),
  base({
    id: 'java',
    name: 'Java',
    emoji: '☕',
    icon: 'coffee',
    description: 'Core Java, the JVM and Spring.',
    searchHint: 'java',
    keywords: ['java', 'jvm', 'jdk', 'java programming', 'core java'],
    topics: [
      t('java-basics', 'Basics', ['java tutorial', 'java basics', '~variables', '~data types', '~loops']),
      t('oop', 'OOP', ['oop', 'object oriented programming', 'inheritance', 'polymorphism', 'encapsulation', '~abstraction', '~interface']),
      t('collections', 'Collections', ['collections framework', 'arraylist', 'hashmap', 'linkedlist', '~collections']),
      t('exceptions', 'Exceptions', ['exception handling', 'try catch', '~exception']),
      t('streams', 'Streams & Lambdas', ['stream api', 'lambda expression', 'functional interface', '~streams', '~lambda']),
      t('concurrency', 'Multithreading', ['multithreading', 'concurrency', 'executor service', '~thread']),
      t('spring', 'Spring Boot', ['spring boot', 'spring framework', 'hibernate', 'jpa', '~spring']),
    ],
  }),
  base({
    id: 'relax',
    name: 'Relaxation',
    emoji: '🌿',
    icon: 'leaf',
    kind: 'media',
    description: 'Intentional downtime — calm, not a scroll hole.',
    searchHint: '',
    keywords: ['relaxing', 'relax', 'calm', 'ambient', 'lofi', 'lo-fi', 'sleep music'],
    blockedKeywords: ['prank', 'drama'],
    dailyLimitMinutes: 45,
    topics: [
      t('music', 'Lo-fi & Music', ['lofi', 'lo-fi', 'piano', 'instrumental', '~music', '~playlist']),
      t('nature', 'Nature & Ambience', ['nature sounds', 'rain sounds', 'ambience', '~forest', '~ocean']),
      t('meditation', 'Meditation', ['meditation', 'mindfulness', 'breathing exercise', 'guided meditation']),
      t('documentaries', 'Documentaries', ['documentary']),
    ],
    filterOverride: {
      intensity: 'gentle',
      filters: {
        hideShorts: true,
        replaceHomeFeed: true,
        relatedVideos: 'show',
        hideEndScreens: false,
        hideExplore: false,
        hideComments: false,
        hideNotifications: false,
        searchResults: 'show',
      },
    },
  }),
];

/** A blank mode for "Create mode". */
export function blankMode(id: string, now: number): LearningMode {
  return {
    id,
    name: 'New mode',
    emoji: '✨',
    icon: 'sparkles',
    kind: 'learning',
    discovery: true,
    description: '',
    searchHint: '',
    topics: [],
    keywords: [],
    blockedKeywords: [...COMMON_BLOCKED],
    allowedChannels: [],
    blockedChannels: [],
    dailyLimitMinutes: 60,
    filterOverride: null,
    createdAt: now,
    updatedAt: now,
  };
}
