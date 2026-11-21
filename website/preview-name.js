const dialog=document.querySelector('#layout-name-dialog');
const input=dialog.querySelector('input');
let submitName;
dialog.querySelector('[type=button]').onclick=()=>dialog.close();
input.oninput=()=>input.setCustomValidity('');
dialog.querySelector('form').onsubmit=event=>{
  event.preventDefault();
  const name=input.value.trim();
  const error=name ? submitName(name) : 'Enter a name.';
  if(error) { input.setCustomValidity(error); input.reportValidity(); }
  else dialog.close();
};
export function askName(label,value,length,submit) {
  dialog.querySelector('label').textContent=label;
  input.maxLength=length;
  input.value=value;
  input.setCustomValidity('');
  submitName=submit;
  dialog.showModal();
  input.select();
}
