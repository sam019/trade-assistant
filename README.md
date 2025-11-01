初始化部署步骤
1. docker compose build 构建全部镜像
2. docker compose up mongo -d 先部署mongo
3. docker exec -it mongo mongosh && rs.initiate()初始化副本集
4. 复制相关环境变量到新建的.env中，部署后立刻删除
5. docker compose up -d 部署其他服务
6. ！！！删除.env！！！

更新服务步骤
mongo一般不需要更新，最多清空下卷
部署web需要:
docker compose up web --build -d
部署server需要执行初始化第4步，复制环境变量，然后
docker compose up server --build -d
然后  ！！！删除.env！！！