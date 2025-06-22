FROM archlinux:latest

# Install basic Linux utilities and main libraries
RUN pacman -Syu --noconfirm && \
    pacman -S --noconfirm \
        python python-pip gcc git \
        base-devel \
        curl wget vim nano less \
        unzip zip tar \
        sudo \
        net-tools iputils dnsutils \
        ca-certificates \
        openssl \
        libffi \
        bzip2 \
        readline \
        sqlite \
        ncurses \
        xz \
        glibc \
        htop \
        tree \
        lsof \
        rsync \
        jq \
        tmux \
        man-db \
        bash-completion \
        iptables && \
    pacman -Scc --noconfirm

# Create a non-root user 'developer' with passwordless sudo and give pip install permissions
RUN useradd -m -s /bin/bash developer && \
    echo "developer ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers && \
    chown -R developer:developer /home/developer && \
    chown -R developer:developer /usr/lib/python3.*/site-packages /usr/bin || true

USER developer
WORKDIR /home/developer

# Set default shell
CMD ["/bin/bash"]