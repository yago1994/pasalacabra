export type Letter =
  | "A"|"B"|"C"|"D"|"E"|"F"|"G"|"H"|"I"|"J"|"L"|"M"|"N"|"Ñ"|"O"|"P"|"Q"|"R"|"S"|"T"|"U"|"V"|"X"|"Y"|"Z";

export type Topic = 
  | "astronomia" 
  | "biologia" 
  | "musica" 
  | "deporte" 
  | "ciencia" 
  | "cine" 
  | "historia" 
  | "geografia" 
  | "arte" 
  | "folklore"
  | "culturageneral";

export type QA = {
  id: string;
  topic: Topic;
  letter: Letter;
  question: string;
  answer: string;
};