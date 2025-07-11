<script>
    import { onMount } from 'svelte';
    import { DatabaseManager } from '../../lib/database.js';
    
    import { 
        Database, 
        Plus, 
        Edit, 
        Trash2, 
        Save, 
        X,
        Search,
        Filter,
        Download,
        Upload
    } from 'lucide-svelte';
    
    let databaseManager = new DatabaseManager();
    let collections = [];
    let selectedCollection = null;
    let documents = [];
    let showCreateModal = false;
    let showDocumentModal = false;
    let editingDocument = null;
    let newDocument = {};
    let searchQuery = '';
    let currentPage = 1;
    let totalPages = 1;
    let itemsPerPage = 10;
    
    function setupCallbacks() {
        databaseManager.setCallbacks({
            onCollectionsUpdate: (updatedCollections) => {
                collections = updatedCollections;
            },
            onDocumentsUpdate: (updatedDocuments, pagination) => {
                documents = updatedDocuments;
                totalPages = pagination.totalPages;
                currentPage = pagination.currentPage;
            },
            onError: (error) => {
                console.error('Database error:', error);
            }
        });
    }
    
    async function fetchCollections() {
        try {
            collections = await databaseManager.fetchCollections();
        } catch (error) {
            console.error('Failed to fetch collections:', error);
        }
    }
    
    async function fetchDocuments() {
        if (!selectedCollection) return;
        
        try {
            const result = await databaseManager.fetchDocuments(
                selectedCollection.name, 
                currentPage, 
                itemsPerPage, 
                searchQuery
            );
            documents = result.documents;
            totalPages = result.totalPages;
        } catch (error) {
            console.error('Failed to fetch documents:', error);
        }
    }
    
    async function createDocument() {
        if (!selectedCollection || !newDocument) return;
        
        try {
            await databaseManager.createDocument(selectedCollection.name, newDocument);
            await fetchDocuments();
            resetDocumentForm();
        } catch (error) {
            console.error('Failed to create document:', error);
        }
    }
    
    async function updateDocument() {
        if (!selectedCollection || !editingDocument) return;
        
        try {
            await databaseManager.updateDocument(
                selectedCollection.name, 
                editingDocument.id, 
                newDocument
            );
            await fetchDocuments();
            resetDocumentForm();
        } catch (error) {
            console.error('Failed to update document:', error);
        }
    }
    
    async function deleteDocument(documentId) {
        if (!confirm('Are you sure you want to delete this document?')) return;
        
        try {
            await databaseManager.deleteDocument(selectedCollection.name, documentId);
            await fetchDocuments();
        } catch (error) {
            console.error('Failed to delete document:', error);
        }
    }
    
    function editDocument(document) {
        editingDocument = document;
        newDocument = { ...document };
        showDocumentModal = true;
    }
    
    function resetDocumentForm() {
        showDocumentModal = false;
        editingDocument = null;
        newDocument = {};
    }
    
    function selectCollection(collection) {
        selectedCollection = collection;
        currentPage = 1;
        searchQuery = '';
        fetchDocuments();
    }
    
    function handleSearch() {
        currentPage = 1;
        fetchDocuments();
    }
    
    function nextPage() {
        if (currentPage < totalPages) {
            currentPage++;
            fetchDocuments();
        }
    }
    
    function prevPage() {
        if (currentPage > 1) {
            currentPage--;
            fetchDocuments();
        }
    }
    
    onMount(() => {
        setupCallbacks();
        fetchCollections();
    });
</script>

<div class="tab-content">
    <div class="database-layout">
        <div class="collections-sidebar">
            <div class="sidebar-header">
                <h3>Collections</h3>
                <button class="btn btn-sm btn-primary" on:click={() => showCreateModal = true}>
                    <Plus size="14" />
                </button>
            </div>
            
            <div class="collections-list">
                {#each collections as collection}
                    <button 
                        class="collection-item {selectedCollection?.name === collection.name ? 'active' : ''}"
                        on:click={() => selectCollection(collection)}
                    >
                        <Database size="16" />
                        <span>{collection.name}</span>
                        <span class="document-count">{collection.documentCount}</span>
                    </button>
                {/each}
            </div>
        </div>
        
        <div class="documents-main">
            {#if selectedCollection}
                <div class="documents-header">
                    <h2>{selectedCollection.name}</h2>
                    <div class="documents-actions">
                        <div class="search-box">
                            <Search size="16" />
                            <input 
                                class="search-input" 
                                type="text" 
                                bind:value={searchQuery}
                                placeholder="Search documents..."
                                on:input={handleSearch}
                            />
                        </div>
                        <button class="btn btn-primary" on:click={() => showDocumentModal = true}>
                            <Plus size="16" /> Add Document
                        </button>
                    </div>
                </div>
                
                {#if documents.length === 0}
                    <div class="empty-state">
                        <Database size="48" />
                        <p>No documents found</p>
                        <small>Add your first document to get started</small>
                    </div>
                {:else}
                    <div class="documents-table">
                        <div class="table-header">
                            <div class="table-row">
                                <div class="table-cell">ID</div>
                                <div class="table-cell">Data</div>
                                <div class="table-cell">Actions</div>
                            </div>
                        </div>
                        
                        <div class="table-body">
                            {#each documents as document}
                                <div class="table-row">
                                    <div class="table-cell">{document.id}</div>
                                    <div class="table-cell">
                                        <pre class="document-preview">{JSON.stringify(document.data, null, 2)}</pre>
                                    </div>
                                    <div class="table-cell">
                                        <button class="btn btn-sm" on:click={() => editDocument(document)}>
                                            <Edit size="14" />
                                        </button>
                                        <button class="btn btn-sm btn-danger" on:click={() => deleteDocument(document.id)}>
                                            <Trash2 size="14" />
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </div>
                    
                    <div class="pagination">
                        <button class="btn btn-sm" on:click={prevPage} disabled={currentPage === 1}>
                            Previous
                        </button>
                        <span class="page-info">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button class="btn btn-sm" on:click={nextPage} disabled={currentPage === totalPages}>
                            Next
                        </button>
                    </div>
                {/if}
            {:else}
                <div class="empty-state">
                    <Database size="48" />
                    <p>Select a collection to view documents</p>
                    <small>Choose a collection from the sidebar to get started</small>
                </div>
            {/if}
        </div>
    </div>
</div>

{#if showDocumentModal}
    <div class="modal-overlay" on:click={resetDocumentForm}>
        <div class="modal" on:click|stopPropagation>
            <div class="modal-header">
                <h3>{editingDocument ? 'Edit Document' : 'Create Document'}</h3>
                <button class="btn btn-sm" on:click={resetDocumentForm}>
                    <X size="16" />
                </button>
            </div>
            
            <div class="modal-content">
                <div class="form-section">
                    <label class="form-label">
                        Document Data (JSON)
                        <textarea 
                            class="form-textarea" 
                            bind:value={newDocument}
                            placeholder="Enter JSON data..."
                            rows="10"
                        ></textarea>
                    </label>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" on:click={resetDocumentForm}>Cancel</button>
                <button class="btn btn-primary" on:click={editingDocument ? updateDocument : createDocument}>
                    <Save size="16" /> {editingDocument ? 'Update' : 'Create'} Document
                </button>
            </div>
        </div>
    </div>
{/if}