fn main() {
  // 图标经 gen:icons 脚本生成，变更后需触发重嵌（tauri_build 默认只监听 tauri.conf.json）
  println!("cargo:rerun-if-changed=icons");
  tauri_build::build()
}
