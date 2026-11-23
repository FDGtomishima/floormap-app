import type messages from "../../messages/ja.json";

// メッセージのキーを型でチェックする
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}
