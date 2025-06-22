we have a gun js layer running in backend, which has option to become a superpeer, a superpeer has capability of keeping a persistent database, and the ability to relay between peers. the superpeer thus can allow discovery, and then allow to see the resources, now there can be two ways, directly connect to another peer and deploy a docker container with linux in it such that we can run an entire terminal os and run all our codes etc in it in real time. else, we can use it for web hosting, we will deploy the docker container which has server bundled into it, it has endpoints, the super peer will relay these endpoints requests and responses and itself serves as the database instead of third party database providers. thus allowing full scale webservices or hosting. this all is now in backend, and we have endpoints to run all these functions, then we will have a frontend which can utilize all these endpoints and give a UI.



before starting, ensure you have docker, then run:
╰─ docker build -t de-cloud-dev:latest .                                      ─╯

