import { finite } from '../utils.js';
export function dailyRegimeAt(prepared,index){
  const c=prepared.close[index],m50=prepared.sma50[index],m200=prepared.sma200[index];
  const p50=index>=20?prepared.sma50[index-20]:null,p200=index>=20?prepared.sma200[index-20]:null;
  if(![c,m50,m200].every(finite))return{code:'?',label:'データ不足',description:'200日分未満'};
  const slope50=finite(p50)?Number(m50)-Number(p50):0,slope200=finite(p200)?Number(m200)-Number(p200):0;
  if(c>m50&&m50>m200&&slope50>=0&&slope200>=0)return{code:'S2',label:'上昇レジーム',description:'株価>50日線>200日線、両線上向き'};
  if(c<m50&&m50<m200&&slope50<=0&&slope200<=0)return{code:'S4',label:'下降レジーム',description:'株価<50日線<200日線、両線下向き'};
  if(c>=m200&&slope200>=0)return{code:'S1',label:'基盤形成',description:'200日線上、上昇移行前'};
  return{code:'S3',label:'天井・移行',description:'上昇レジーム崩れ'};
}
