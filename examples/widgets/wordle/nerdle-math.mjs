// Exact rational arithmetic: no eval/Function and no floating-point comparisons.
export const normalizeEquation = value => String(value ?? '').replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
const gcd=(a,b)=>{a=a<0n?-a:a;while(b){[a,b]=[b,a%b];}return a||1n;};
function rational(n,d=1n){if(d===0n)throw Error('Деление на ноль');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};}
function calculate(a,op,b){if(op==='+')return rational(a.n*b.d+b.n*a.d,a.d*b.d);if(op==='-')return rational(a.n*b.d-b.n*a.d,a.d*b.d);if(op==='*')return rational(a.n*b.n,a.d*b.d);return rational(a.n*b.d,a.d*b.n);}
export function evaluateExpression(text){
 if(!text||text.length>64||!/^[0-9+*/-]+$/.test(text)||text.includes('--'))throw Error('Недопустимое выражение');
 let pos=0;
 function number(){let sign=1n;if(text[pos]==='-'){sign=-1n;pos++;}const start=pos;while(/[0-9]/.test(text[pos]||'!'))pos++;const digits=text.slice(start,pos);if(!digits)throw Error('Ожидается число');if(digits.length>1&&digits[0]==='0')throw Error('Числа с ведущими нулями запрещены');return rational(sign*BigInt(digits));}
 function term(){let a=number();while(text[pos]==='*'||text[pos]==='/'){const op=text[pos++];a=calculate(a,op,number());}return a;}
 let a=term();while(text[pos]==='+'||text[pos]==='-'){const op=text[pos++];a=calculate(a,op,term());}if(pos!==text.length)throw Error('Некорректная последовательность знаков');return a;
}
export function validateEquation(value,length=8){
 const equation=normalizeEquation(value);
 try{
  if(equation.length!==length)throw Error(`Нужно ${length} символов`);
  if(!/^[0-9+*/=-]+$/.test(equation)||equation.includes('--'))throw Error('Недопустимые символы или последовательность --');
  const parts=equation.split('=');if(parts.length!==2)throw Error('Нужен ровно один знак =');
  if(!/^-?(0|[1-9][0-9]*)$/.test(parts[1]))throw Error('Справа от = должно быть только число');
  if(!/[+*/-]/.test(parts[0].replace(/^-/,'')))throw Error('Слева нужна арифметическая операция');
  const left=evaluateExpression(parts[0]),right=evaluateExpression(parts[1]);
  if(left.n*right.d!==right.n*left.d)throw Error('Равенство неверно');
  return {ok:true,equation};
 }catch(error){return {ok:false,equation,error:error.message};}
}

export function appendEquationKey(input,key,length=8){
 const next=input+key;
 if(key!=='='||input.includes('='))return next;
 try{
  const result=evaluateExpression(input);
  if(result.d!==1n)return next;
  const candidate=next+result.n.toString();
  if(candidate.length>length||!validateEquation(candidate,candidate.length).ok)return next;
  return candidate;
 }catch{return next;}
}
