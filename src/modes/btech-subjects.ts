/**
 * B.Tech subjects → their subtopics: the units most Indian university syllabi (AKTU, VTU, GTU, Mumbai,
 * Anna, JNTU) teach under that subject name. They are a subject's subtopics in the Space, its relevance
 * keywords, and what the subtopic chips on the home page filter by.
 */
export const SUBTOPICS: Record<string, string[]> = {
  // First year (all branches)
  'Engineering Mathematics': ['differential calculus', 'integral calculus', 'matrices', 'differential equations', 'laplace transform', 'fourier series', 'vector calculus'],
  'Engineering Physics': ['quantum mechanics', 'optics', 'lasers', 'semiconductors', 'electromagnetic theory', 'wave optics'],
  'Engineering Chemistry': ['water treatment', 'electrochemistry', 'corrosion', 'polymers', 'fuels and combustion', 'spectroscopy'],
  'Programming in C': ['c programming', 'pointers in c', 'arrays in c', 'functions in c', 'structures in c', 'file handling in c'],
  'Basic Electrical Engineering': ['dc circuits', 'ac circuits', 'transformers', 'kirchhoff laws', 'three phase circuits', 'electrical machines basics'],
  'Engineering Graphics': ['orthographic projection', 'isometric projection', 'projection of solids', 'sections of solids', 'autocad'],
  'Engineering Mechanics': ['free body diagram', 'equilibrium', 'friction', 'centroid and moment of inertia', 'trusses', 'kinematics of particles'],

  // CSE / IT
  'Data Structures': ['arrays', 'linked list', 'stack', 'queue', 'binary tree', 'binary search tree', 'heap', 'graph', 'hashing', 'sorting algorithms'],
  'Discrete Mathematics': ['set theory', 'relations and functions', 'propositional logic', 'graph theory', 'combinatorics', 'group theory', 'recurrence relations'],
  'Digital Logic': ['number systems', 'boolean algebra', 'k map', 'combinational circuits', 'flip flops', 'counters', 'multiplexer'],
  'Computer Organization and Architecture': ['instruction set', 'addressing modes', 'pipelining', 'cache memory', 'memory hierarchy', 'io organization', 'alu design'],
  'Object Oriented Programming': ['classes and objects', 'inheritance', 'polymorphism', 'encapsulation', 'abstraction', 'oops in java', 'oops in c++'],
  'Probability and Statistics': ['probability', 'random variables', 'probability distributions', 'bayes theorem', 'hypothesis testing', 'regression'],
  'Operating System': ['process scheduling', 'cpu scheduling', 'deadlock', 'paging', 'virtual memory', 'semaphore', 'process synchronization', 'file systems'],
  DBMS: ['er model', 'normalization', 'sql', 'relational algebra', 'transactions', 'concurrency control', 'indexing', 'functional dependency'],
  'Computer Networks': ['osi model', 'tcp ip', 'ip addressing', 'subnetting', 'routing algorithms', 'flow control', 'congestion control', 'dns'],
  'Theory of Computation': ['finite automata', 'dfa', 'nfa', 'regular expression', 'context free grammar', 'pushdown automata', 'turing machine'],
  'Design and Analysis of Algorithms': ['time complexity', 'divide and conquer', 'greedy algorithm', 'dynamic programming', 'backtracking', 'graph algorithms', 'np completeness'],
  'Software Engineering': ['sdlc', 'agile', 'software testing', 'uml diagrams', 'requirement analysis', 'software project management'],
  'Compiler Design': ['lexical analysis', 'parsing', 'lr parser', 'syntax directed translation', 'intermediate code generation', 'code optimization'],
  'Machine Learning': ['linear regression', 'logistic regression', 'decision tree', 'svm', 'clustering', 'neural network'],
  'Cloud Computing': ['virtualization', 'cloud service models', 'aws', 'cloud deployment models', 'containers'],
  'Cryptography and Network Security': ['symmetric encryption', 'rsa', 'hash functions', 'digital signature', 'firewall', 'network attacks'],
  'Distributed Systems': ['distributed systems', 'consensus', 'replication', 'clock synchronization', 'distributed transactions'],
  'Data Mining': ['data preprocessing', 'association rules', 'apriori algorithm', 'classification', 'clustering', 'data warehouse'],
  'Artificial Intelligence': ['search algorithms', 'a star algorithm', 'knowledge representation', 'expert systems', 'minimax', 'heuristic search'],

  // ECE
  'Network Analysis': ['network theorems', 'transient analysis', 'two port networks', 'resonance', 'thevenin theorem', 'laplace in circuits'],
  'Electronic Devices': ['pn junction diode', 'bjt', 'mosfet', 'zener diode', 'semiconductor physics'],
  'Analog Circuits': ['amplifiers', 'op amp', 'oscillators', 'feedback amplifiers', 'power amplifiers', 'filters'],
  'Digital Electronics': ['logic gates', 'boolean algebra', 'k map', 'flip flops', 'counters', 'registers'],
  'Signals and Systems': ['fourier transform', 'laplace transform', 'z transform', 'convolution', 'lti systems', 'sampling theorem'],
  'Control Systems': ['transfer function', 'block diagram', 'root locus', 'bode plot', 'nyquist plot', 'state space', 'stability'],
  'Analog Communication': ['amplitude modulation', 'frequency modulation', 'noise', 'superheterodyne receiver'],
  'Digital Communication': ['pcm', 'digital modulation', 'ask fsk psk', 'information theory', 'line coding'],
  'Electromagnetic Theory': ['maxwell equations', 'electrostatics', 'magnetostatics', 'transmission lines', 'wave propagation'],
  'Microprocessors and Microcontrollers': ['8085', '8086', '8051 microcontroller', 'assembly language', 'interfacing', 'arm processor'],
  'Digital Signal Processing': ['dft', 'fft', 'fir filter', 'iir filter', 'z transform'],
  'VLSI Design': ['cmos', 'verilog', 'vhdl', 'fpga', 'asic design', 'layout design'],
  'Embedded Systems': ['embedded c', 'arduino', 'rtos', 'iot', 'raspberry pi'],
  'Antenna and Wave Propagation': ['antenna parameters', 'dipole antenna', 'antenna arrays', 'wave propagation'],
  'Wireless Communication': ['cellular concept', 'fading', 'ofdm', 'mimo', '5g'],
  'Optical Communication': ['optical fiber', 'light sources', 'photodetectors', 'fiber losses'],

  // EE
  'Electrical Machines': ['dc machines', 'transformers', 'induction motor', 'synchronous machines', 'dc motor'],
  'Analog Electronics': ['diode circuits', 'bjt amplifiers', 'op amp', 'rectifiers'],
  'Electromagnetic Fields': ['electrostatics', 'magnetostatics', 'maxwell equations', 'electromagnetic waves'],
  'Electrical Measurements': ['measuring instruments', 'bridges', 'cro', 'transducers', 'energy meter'],
  'Power Systems': ['transmission lines', 'load flow analysis', 'fault analysis', 'power system stability', 'per unit system'],
  'Power Electronics': ['thyristor', 'rectifiers', 'choppers', 'inverters', 'cycloconverters'],
  Microprocessors: ['8085', '8086', 'assembly language', 'interfacing'],
  'Switchgear and Protection': ['circuit breakers', 'relays', 'protection schemes', 'fuses'],
  'Electric Drives': ['dc drives', 'ac drives', 'speed control of motors'],
  'Renewable Energy': ['solar energy', 'wind energy', 'energy storage', 'smart grid'],
  'HVDC Transmission': ['hvdc', 'converters', 'facts devices'],
  'Utilization of Electrical Energy': ['electric heating', 'illumination', 'electric traction'],

  // ME
  'Strength of Materials': ['stress and strain', 'bending moment', 'shear force', 'torsion', 'deflection of beams', 'mohr circle', 'columns'],
  Thermodynamics: ['laws of thermodynamics', 'entropy', 'carnot cycle', 'properties of steam', 'availability'],
  'Fluid Mechanics': ['fluid statics', 'bernoulli equation', 'flow through pipes', 'boundary layer', 'dimensional analysis', 'viscous flow'],
  'Manufacturing Processes': ['casting', 'welding', 'forming', 'machining', 'metal cutting'],
  'Material Science': ['crystal structure', 'phase diagrams', 'heat treatment', 'iron carbon diagram'],
  'Kinematics of Machines': ['mechanisms', 'velocity analysis', 'cams', 'gears', 'gear trains'],
  'Theory of Machines': ['governors', 'flywheel', 'balancing', 'vibrations', 'gyroscope'],
  'Heat Transfer': ['conduction', 'convection', 'radiation', 'heat exchangers', 'fins'],
  'Machine Design': ['design of shafts', 'bearings', 'springs', 'gears design', 'fatigue'],
  'IC Engines': ['otto cycle', 'diesel cycle', 'combustion in engines', 'fuel injection'],
  'Applied Thermodynamics': ['rankine cycle', 'gas turbines', 'compressors', 'steam turbines'],
  Metrology: ['limits fits tolerances', 'measuring instruments', 'surface finish', 'gauges'],
  'Refrigeration and Air Conditioning': ['vapour compression', 'refrigerants', 'psychrometry', 'air conditioning'],
  'CAD CAM': ['cnc programming', 'cad modelling', 'solidworks', 'finite element basics'],
  'Industrial Engineering': ['operations research', 'linear programming', 'inventory control', 'work study'],
  'Automobile Engineering': ['transmission system', 'braking system', 'steering system', 'suspension'],
  'Finite Element Analysis': ['fem', 'stiffness matrix', 'ansys', 'shape functions'],

  // Civil
  Surveying: ['chain surveying', 'levelling', 'theodolite', 'total station', 'contouring'],
  'Building Materials': ['cement', 'concrete', 'bricks', 'aggregates', 'mix design'],
  'Engineering Geology': ['rocks and minerals', 'weathering', 'earthquakes', 'site investigation'],
  'Structural Analysis': ['determinate structures', 'indeterminate structures', 'slope deflection', 'moment distribution', 'influence lines'],
  'Soil Mechanics': ['soil classification', 'permeability', 'consolidation', 'shear strength', 'compaction'],
  'RCC Design': ['limit state design', 'design of beams', 'design of slabs', 'design of columns', 'is 456'],
  'Transportation Engineering': ['highway engineering', 'pavement design', 'traffic engineering', 'railway engineering'],
  Hydrology: ['rainfall', 'runoff', 'hydrograph', 'groundwater'],
  'Environmental Engineering': ['water supply', 'water treatment', 'sewage treatment', 'air pollution'],
  'Steel Structures': ['steel connections', 'tension members', 'compression members', 'design of steel beams'],
  'Foundation Engineering': ['shallow foundation', 'pile foundation', 'bearing capacity', 'retaining walls'],
  'Construction Management': ['cpm pert', 'project scheduling', 'construction equipment'],
  'Estimation and Costing': ['quantity estimation', 'rate analysis', 'valuation'],
  'Irrigation Engineering': ['canals', 'dams', 'irrigation methods', 'water requirement of crops'],
};

/**
 * Skills learned alongside the degree, for placements and beyond. CSE gets DSA, development and AI/ML
 * by default; every branch can add any of them. Keywords are what the subject's lessons are called.
 */
export const SKILLS: { id: string; name: string; keywords: string[]; branches?: string[] }[] = [
  { id: 'dsa', name: 'DSA', keywords: ['data structures and algorithms', 'dsa', 'leetcode', 'dynamic programming', 'graph algorithms', 'binary tree', 'linked list', 'recursion', 'coding interview'] },
  { id: 'webdev', name: 'Web Development', keywords: ['web development', 'frontend', 'backend', 'full stack', 'react', 'javascript', 'node.js', 'html css', 'mern stack', 'next.js'] },
  { id: 'aiml', name: 'AI / ML', keywords: ['machine learning', 'deep learning', 'artificial intelligence', 'neural network', 'llm', 'pytorch', 'generative ai', 'nlp', 'computer vision'] },
  { id: 'sysdesign', name: 'System Design', keywords: ['system design', 'low level design', 'high level design', 'distributed systems', 'scalability', 'load balancing', 'caching', 'microservices'] },
  { id: 'datascience', name: 'Data Science', keywords: ['data science', 'data analysis', 'pandas', 'numpy', 'data visualization', 'power bi', 'sql for data analysis'] },
  { id: 'appdev', name: 'App Development', keywords: ['android development', 'flutter', 'react native', 'kotlin', 'app development'] },
  { id: 'cloud', name: 'Cloud & DevOps', keywords: ['devops', 'docker', 'kubernetes', 'aws', 'ci/cd', 'cloud computing'] },
  { id: 'security', name: 'Cybersecurity', keywords: ['cybersecurity', 'ethical hacking', 'network security', 'penetration testing'] },
  { id: 'cp', name: 'Competitive Programming', keywords: ['competitive programming', 'codeforces', 'codechef', 'contest'] },
  { id: 'embedded', name: 'Embedded & IoT', keywords: ['embedded systems', 'arduino', 'iot', 'microcontroller', 'raspberry pi'], branches: ['ece', 'ee'] },
  { id: 'vlsi', name: 'VLSI', keywords: ['vlsi', 'verilog', 'fpga', 'digital design'], branches: ['ece'] },
  { id: 'cad', name: 'CAD & Simulation', keywords: ['autocad', 'solidworks', 'ansys', 'catia', 'staad pro'], branches: ['me', 'ce'] },
  { id: 'placements', name: 'Placement Prep', keywords: ['placement preparation', 'aptitude', 'interview preparation', 'hr interview', 'resume'] },
];
