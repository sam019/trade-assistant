初始化部署步骤
1. docker compose build 构建全部镜像
2. 复制相关环境变量到新建的.env中，部署后立刻删除
3. docker compose up server -d 部署后端服务
4. docker compose up web -d 部署前端服务 （不同时部署是因为vps配置不够高，容易卡死）
5. ！！！删除.env！！！

更新服务步骤
部署web需要:
docker compose up web --build -d
部署server需要：
执行初始化第2步，复制环境变量，然后执行
docker compose up server --build -d
然后  ！！！删除.env！！！