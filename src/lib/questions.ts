export const SPANISH_LETTERS = [
  "A","B","C","D","E","F","G","H","I","J","L","M","N","Ñ","O","P","Q","R","S","T","U","V","X","Y","Z"
] as const;

export type Letter = typeof SPANISH_LETTERS[number];

export type QA = {
  letter: Letter;
  question: string;
  answer: string;
};

export const QUESTIONS: QA[] = [
  { letter: "A", question: "Con la A: Fruta verde por fuera y cremosa por dentro, típica del guacamole.", answer: "Aguacate" },
  { letter: "B", question: "Con la B: Lugar donde se prestan libros.", answer: "Biblioteca" },
  { letter: "C", question: "Con la C: Mamífero marsupial que salta y vive en Australia.", answer: "Canguro" },
  { letter: "D", question: "Con la D: Mamífero marino muy inteligente que suele vivir en grupos.", answer: "Delfín" },
  { letter: "E", question: "Con la E: Fenómeno astronómico cuando un cuerpo tapa la luz de otro.", answer: "Eclipse" },
  { letter: "F", question: "Con la F: Instrumento musical de viento, normalmente de madera o metal.", answer: "Flauta" },
  { letter: "G", question: "Con la G: Planta con flor amarilla que gira buscando el sol.", answer: "Girasol" },
  { letter: "H", question: "Con la H: Vehículo aéreo con hélices que puede despegar en vertical.", answer: "Helicóptero" },
  { letter: "I", question: "Con la I: Objeto que atrae metales como el hierro.", answer: "Imán" },
  { letter: "J", question: "Con la J: Espacio con plantas y flores, normalmente al aire libre.", answer: "Jardín" },
  { letter: "L", question: "Con la L: Lugar con caminos enredados diseñado para perderse.", answer: "Laberinto" },
  { letter: "M", question: "Con la M: Insecto con alas de colores que empieza como oruga.", answer: "Mariposa" },
  { letter: "N", question: "Con la N: Fruta cítrica y naranja por fuera, rica en vitamina C.", answer: "Naranja" },
  { letter: "Ñ", question: "Con la Ñ: Ave corredora sudamericana parecida al avestruz.", answer: "Ñandú" },
  { letter: "O", question: "Con la O: Gran extensión de agua salada que cubre gran parte de la Tierra.", answer: "Océano" },
  { letter: "P", question: "Con la P: Construcción monumental triangular del Antiguo Egipto.", answer: "Pirámide" },
  { letter: "Q", question: "Con la Q: Ave de colores de Centroamérica, también nombre de una moneda.", answer: "Quetzal" },
  { letter: "R", question: "Con la R: Aparato que da la hora y puede ir en la muñeca.", answer: "Reloj" },
  { letter: "S", question: "Con la S: Objeto que orbita un planeta para comunicar o medir.", answer: "Satélite" },
  { letter: "T", question: "Con la T: Pieza metálica con rosca que se atornilla con destornillador.", answer: "Tornillo" },
  { letter: "U", question: "Con la U: Conjunto de todo lo que existe: espacio, tiempo, materia y energía.", answer: "Universo" },
  { letter: "V", question: "Con la V: Personaje mítico que, según la leyenda, bebe sangre.", answer: "Vampiro" },
  { letter: "X", question: "Contiene la X: Prueba o evaluación en un colegio o universidad.", answer: "Examen" },
  { letter: "Y", question: "Contiene la Y: Zona de arena junto al mar.", answer: "Playa" },

  { letter: "Z", question: "Con la Z: Verdura naranja, típica en ensaladas y guisos.", answer: "Zanahoria" },
];