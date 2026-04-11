"""Test fixtures."""

import pytest


@pytest.fixture
def sample_js_content() -> str:
    return '''
import React from 'react';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import styles from './Dashboard.module.css';

const API_URL = 'http://localhost:3000';

export function Dashboard({ user }) {
    const [data, setData] = useState(null);

    useEffect(() => {
        api.fetchDashboard().then(setData);
    }, []);

    return <div className={styles.container}>{data}</div>;
}

export class DataService {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async fetchData(endpoint) {
        const response = await fetch(`${this.baseUrl}/${endpoint}`);
        return response.json();
    }
}

const helper = (x) => x * 2;

export default Dashboard;
'''


@pytest.fixture
def sample_ts_content() -> str:
    return '''
import { Router, Request, Response } from 'express';
import { UserService } from '../services/UserService';
import type { User, CreateUserDTO } from '../types/user';

interface AuthConfig {
    secret: string;
    expiresIn: number;
}

type UserRole = 'admin' | 'user' | 'moderator';

enum Status {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
}

export class UserController {
    private userService: UserService;

    constructor(userService: UserService) {
        this.userService = userService;
    }

    async getUser(req: Request, res: Response): Promise<void> {
        const user = await this.userService.findById(req.params.id);
        res.json(user);
    }

    async createUser(req: Request, res: Response): Promise<void> {
        const dto: CreateUserDTO = req.body;
        const user = await this.userService.create(dto);
        res.status(201).json(user);
    }
}

export const createRouter = (controller: UserController): Router => {
    const router = Router();
    router.get('/:id', controller.getUser.bind(controller));
    router.post('/', controller.createUser.bind(controller));
    return router;
};
'''
