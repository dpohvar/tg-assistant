import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createDictionaryStore,normalizeWord} from "./dictionary-store.mjs";
import {normalizeEquation,validateEquation,appendEquationKey} from "./nerdle-math.mjs";

function choose(list,random=Math.random){
  if(!list.length)throw Error("Пул ответов пуст.");
  const value=random();
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>=1)
    throw Error("Некорректный источник случайности.");
  return list[Math.floor(value*list.length)];
}
export function createWordleConfig({base="widgets/wordle",dictionary=createDictionaryStore(base)}={}){
  return {
    title:"WORDLE",defaultLength:5,
    normalize:normalizeWord,
    validateLength(length){if(!Number.isInteger(length)||length<4||length>8)
      throw Error("Длина слова должна быть от 4 до 8 букв");},
    selectAnswer(length,random){this.validateLength(length);return choose(dictionary.selectionWords(length),random);},
    validateGuess(guess,length){this.validateLength(length);
      return dictionary.has(normalizeWord(guess),length)?null:"Такого слова нет в словаре";},
    appendKey(input,key){return input+key;},
    keyboard:[..."АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"],
    keyboardWidth:8,unit:"букв",noun:"Слово",symbol:"буква",
    dictionary,
  };
}
export function createNerdleConfig({base="widgets/wordle"}={}){
  let equations;
  function pool(){
    if(!equations){
      equations=readFileSync(join(base,"classic_equations.txt"),"utf8")
        .trim().split(/\s+/).map(normalizeEquation);
      if(!equations.length||new Set(equations).size!==equations.length||
          equations.some(value=>!validateEquation(value).ok))
        throw Error("Некорректная база classic_equations.txt");
    }
    return equations;
  }
  return {
    title:"NERDLE",defaultLength:8,normalize:normalizeEquation,
    validateLength(length){if(length!==8)throw Error("Classic Nerdle содержит 8 символов");},
    selectAnswer(length,random){this.validateLength(length);return choose(pool(),random);},
    validateGuess(guess,length){const result=validateEquation(guess,length);
      return result.ok?null:result.error;},
    appendKey:appendEquationKey,
    keyboard:[..."1234567890+-*/="],
    keyboardWidth:5,unit:"символов",noun:"Равенство",symbol:"символ",
  };
}
