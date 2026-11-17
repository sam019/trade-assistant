初始化部署步骤
1. 复制相关环境变量到新建的.env中，部署后立刻删除
2. docker compose up server -d 部署后端服务
3. docker compose pull web && docker compose up -d web 部署前端服务
4. ！！！删除.env！！！

更新服务步骤
部署web需要:
• 更新正式版：docker compose pull web && docker compose up -d web
• 更新测试版：IMAGE_TAG=test docker compose pull web && IMAGE_TAG=test docker compose up -d web
部署server需要：
执行初始化第2步，复制环境变量，然后执行
docker compose up server --build -d
然后  ！！！删除.env！！！