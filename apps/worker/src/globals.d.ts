// TS 声明:wrangler Text 规则把 .sql 导入为字符串
declare module "*.sql" {
  const content: string;
  export default content;
}
