export function hostNode(type,props={}) { return {type,props,children:[],parent:null}; }
export function hostText(text) { return {type:"#text",text:String(text),parent:null}; }
export function removeNode(parent,child) {
  const index=parent.children.indexOf(child);
  if(index>=0)parent.children.splice(index,1);
  if(child.parent===parent)child.parent=null;
}
export function insertNode(parent,child,before=null) {
  if(child.parent)removeNode(child.parent,child);
  const index=before===null?-1:parent.children.indexOf(before);
  if(before!==null && index<0)throw Error("Host insertion reference is missing.");
  if(index<0)parent.children.push(child);else parent.children.splice(index,0,child);
  child.parent=parent;
}
