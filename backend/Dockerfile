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

# Install pyenv dependencies and pyenv itself
RUN git clone https://github.com/pyenv/pyenv.git /home/developer/.pyenv

# Create a non-root user 'developer' with passwordless sudo and give pip install permissions
RUN useradd -m -s /bin/bash developer && \
    echo "developer ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers && \
    chown -R developer:developer /home/developer && \
    chown -R developer:developer /usr/lib/python3.*/site-packages /usr/bin || true && \
    chown -R developer:developer /home/developer/.pyenv

USER developer
WORKDIR /home/developer

# Set up pyenv environment variables for the user
RUN echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bashrc && \
    echo 'export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bashrc && \
    echo 'eval "$(pyenv init --path)"' >> ~/.bashrc

# Install Python 3.11, set local version, create venv, activate, and install packages
RUN export PYENV_ROOT="$HOME/.pyenv" && \
    export PATH="$PYENV_ROOT/bin:$PATH" && \
    eval "$(pyenv init --path)" && \
    pyenv install 3.11 && \
    pyenv local 3.11 && \
    python -m venv venv && \
    . venv/bin/activate && \
    pip install --upgrade pip && \
    pip install torch tensorflow pandas scikit-learn transformers

# Set default shell
CMD ["/bin/bash"]